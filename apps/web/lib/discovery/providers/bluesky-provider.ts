// Bluesky as a DiscoveryProvider — credentialKind 'reuse_connection'.
//
// The workspace already handed Prolora a Bluesky app password when it connected
// the channel for publishing. Asking for a second one would be the same dead end
// migration 014 removed, so this provider reads `platform_connections` instead
// of the credential store and stores nothing of its own.
//
// No connection yet is a *state*, not a fault: the caller gets a structured 503
// with code `connect_bluesky_first` plus the deep link to Channels, never a 500
// and never a silent empty result that looks like "nothing found".
//
// Invariante 2: every read below is workspace-scoped and column-explicit —
// platform_connections holds encrypted secrets, so `select('*')` is out.

import { ApiError } from '@/lib/api/http';
import { decrypt } from '@/lib/auth/encryption';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import type {
  CommunityRule,
  DiscoveredCommunityCandidate,
  DiscoveredThread,
  DiscoveryProvider,
  ProviderDegradation,
  ThreadSearchOptions,
} from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';

const SERVICE = 'https://bsky.social';
const REQUEST_TIMEOUT_MS = 10_000;
/** accessJwt lives ~2h; refresh well before that rather than on failure. */
const SESSION_TTL_MS = 60 * 60 * 1000;

/** Only the columns discovery needs — not the full secret-bearing row. */
const BLUESKY_CONNECTION_COLUMNS = 'id, account_name, account_id, app_password_encrypted, status';

interface BlueskyConnectionRow {
  id: string;
  account_name: string;
  account_id: string | null;
  app_password_encrypted: string | null;
  status: string;
}

export interface BlueskyDiscoveryStatus {
  connected: boolean;
  /** Machine-readable; the UI maps it to copy, never parses the message. */
  reason: 'connect_bluesky_first' | null;
  /** Where the user fixes it inside Prolora. */
  deepLink: string;
  handle: string | null;
}

interface BskySession {
  did: string;
  handle: string;
  accessJwt: string;
  expiresAt: number;
}

const sessionCache = new Map<string, BskySession>();

/**
 * Never throws — a missing connection, a missing table and a revoked channel all
 * answer the same shape so the Discover page can render a next step.
 */
export async function getBlueskyDiscoveryStatus(
  workspaceId: string
): Promise<BlueskyDiscoveryStatus> {
  const connection = await readBlueskyConnection(workspaceId);
  if (!connection || !connection.app_password_encrypted) {
    return { connected: false, reason: 'connect_bluesky_first', deepLink: '/connections', handle: null };
  }
  return {
    connected: true,
    reason: null,
    deepLink: '/connections',
    handle: connection.account_name,
  };
}

export async function createBlueskyDiscoveryProvider(
  workspaceId: string
): Promise<BlueskyDiscoveryProvider> {
  const connection = await readBlueskyConnection(workspaceId);
  if (!connection || !connection.app_password_encrypted) {
    throw new ApiError(
      503,
      'Connect Bluesky under Channels first — discovery reuses that app password.',
      'connect_bluesky_first'
    );
  }

  let appPassword: string;
  try {
    appPassword = decrypt(connection.app_password_encrypted);
  } catch (error) {
    console.error('[discovery:bluesky] stored app password could not be decrypted:', error);
    throw new ApiError(
      503,
      'The stored Bluesky app password could not be read. Reconnect Bluesky under Channels.',
      'connect_bluesky_first'
    );
  }

  return new BlueskyDiscoveryProvider(
    connection.id,
    connection.account_id ?? connection.account_name,
    appPassword
  );
}

async function readBlueskyConnection(workspaceId: string): Promise<BlueskyConnectionRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('platform_connections')
    .select(BLUESKY_CONNECTION_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('platform', 'bluesky')
    .eq('status', 'active')
    .limit(1)
    .returns<BlueskyConnectionRow[]>();

  if (error) {
    if (isMissingSchemaError(error.code)) {
      console.error('[discovery:bluesky] platform_connections unavailable:', error.message);
      return null;
    }
    console.error('[discovery:bluesky] connection lookup failed:', error.message);
    return null;
  }
  return data?.[0] ?? null;
}

export class BlueskyDiscoveryProvider implements DiscoveryProvider {
  readonly id: IntegrationProvider = 'bluesky';
  // Bluesky has no communities either — same honest mapping as Hacker News:
  // what is stored is a saved search, and the descriptor says so.
  readonly capabilities = { findCommunities: false, readRules: false, scanThreads: true } as const;
  readonly degradations: ProviderDegradation[] = [];

  constructor(
    private readonly connectionId: string,
    private readonly identifier: string,
    private readonly appPassword: string
  ) {}

  async searchCommunities(
    topics: string[],
    limit: number
  ): Promise<DiscoveredCommunityCandidate[]> {
    const candidates: DiscoveredCommunityCandidate[] = [];
    const seen = new Set<string>();

    for (const raw of topics) {
      if (candidates.length >= limit) break;
      const topic = normalizeTopic(raw);
      if (!topic || seen.has(topic)) continue;
      seen.add(topic);

      const posts = await this.searchPosts(topic, 25, 'latest');
      if (posts.length === 0) continue;
      const authors = new Set(posts.map((post) => post.author));

      candidates.push({
        externalId: topic,
        name: `Bluesky: "${topic}"`,
        url: `https://bsky.app/search?q=${encodeURIComponent(topic)}`,
        description:
          `Saved Bluesky search. Bluesky has no communities — this tracks the topic itself. ` +
          `${posts.length} recent posts from ${authors.size} accounts.`,
        memberCount: authors.size,
        activeCount: authors.size,
        language: null,
        nsfw: false,
        isTopicQuery: true,
      });
    }
    return candidates;
  }

  /** No rules API on the AT Protocol side. `null`, never a throw (Vertrag C2). */
  async getCommunityRules(): Promise<CommunityRule[] | null> {
    return null;
  }

  async searchThreads(
    externalId: string,
    query: string,
    opts: ThreadSearchOptions
  ): Promise<DiscoveredThread[]> {
    const topic = normalizeTopic(externalId);
    if (!topic) return [];
    const posts = await this.searchPosts(topic, Math.min(opts.limit ?? 50, 100), 'latest');
    const cutoff = cutoffSeconds(opts.time);
    const terms = queryTerms(query);
    return posts
      .filter((post) => post.createdAt >= cutoff)
      .filter((post) => matchesTerms(post, terms));
  }

  async getHotThreads(externalId: string, limit: number): Promise<DiscoveredThread[]> {
    const topic = normalizeTopic(externalId);
    if (!topic) return [];
    return this.searchPosts(topic, Math.min(limit, 100), 'top');
  }

  async getCommunityInfo(externalId: string): Promise<DiscoveredCommunityCandidate | null> {
    const [candidate] = await this.searchCommunities([externalId], 1);
    return candidate ?? null;
  }

  private async searchPosts(
    topic: string,
    limit: number,
    sort: 'latest' | 'top'
  ): Promise<DiscoveredThread[]> {
    try {
      const session = await this.session();
      const url =
        `${SERVICE}/xrpc/app.bsky.feed.searchPosts` +
        `?q=${encodeURIComponent(topic)}&limit=${limit}&sort=${sort}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.accessJwt}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 401) {
        // Password rotated or revoked — drop the cached session so the next call
        // re-authenticates instead of replaying a dead JWT.
        sessionCache.delete(this.connectionId);
        this.degrade(topic, 'Bluesky rejected the stored app password (401)');
        return [];
      }
      if (response.status === 429) {
        this.degrade(topic, 'Bluesky rate limit (429) — partial results');
        return [];
      }
      if (!response.ok) {
        this.degrade(topic, `HTTP ${response.status}`);
        return [];
      }

      const json = (await response.json()) as { posts?: unknown };
      const posts = Array.isArray(json.posts) ? json.posts : [];
      return posts.flatMap((post) => {
        const thread = toThread(post, topic);
        return thread ? [thread] : [];
      });
    } catch (error) {
      this.degrade(topic, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async session(): Promise<BskySession> {
    const cached = sessionCache.get(this.connectionId);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const response = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: this.identifier, password: this.appPassword }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Bluesky createSession failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as Partial<BskySession>;
    if (!json.did || !json.accessJwt || !json.handle) {
      throw new Error('Bluesky createSession returned an incomplete session');
    }
    const session: BskySession = {
      did: json.did,
      handle: json.handle,
      accessJwt: json.accessJwt,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    sessionCache.set(this.connectionId, session);
    return session;
  }

  private degrade(source: string, reason: string): void {
    if (this.degradations.some((entry) => entry.source === source)) return;
    this.degradations.push({ source, reason });
    console.error(`[discovery:bluesky] "${source}" degraded: ${reason}`);
  }
}

/** Drops a cached session — call after the Bluesky connection changes. */
export function forgetBlueskySession(connectionId: string): void {
  sessionCache.delete(connectionId);
}

function normalizeTopic(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 120);
}

function toThread(raw: unknown, topic: string): DiscoveredThread | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const post = raw as {
    uri?: string;
    cid?: string;
    author?: { handle?: string; did?: string };
    record?: { text?: string; createdAt?: string };
    likeCount?: number;
    replyCount?: number;
    indexedAt?: string;
  };
  if (!post.uri) return null;

  const text = post.record?.text ?? '';
  const created = post.record?.createdAt ?? post.indexedAt;
  const handle = post.author?.handle ?? '';
  const rkey = post.uri.split('/').pop() ?? '';

  return {
    externalId: post.uri,
    title: text.split('\n')[0]?.slice(0, 160) || `Bluesky post by @${handle}`,
    body: text,
    author: handle,
    communityName: `Bluesky: "${topic}"`,
    url: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : post.uri,
    createdAt: created ? Math.floor(Date.parse(created) / 1000) || 0 : 0,
    score: post.likeCount ?? 0,
    replies: post.replyCount ?? 0,
  };
}

function queryTerms(query: string): string[] {
  return query
    .split(/\s+OR\s+/i)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function matchesTerms(thread: DiscoveredThread, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = `${thread.title} ${thread.body}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function cutoffSeconds(time: ThreadSearchOptions['time']): number {
  const now = Math.floor(Date.now() / 1000);
  switch (time) {
    case 'hour':
      return now - 3600;
    case 'day':
      return now - 86400;
    case 'week':
      return now - 7 * 86400;
    default:
      return 0;
  }
}
