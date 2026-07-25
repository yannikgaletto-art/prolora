// Mastodon as a DiscoveryProvider — credentialKind 'none'.
//
// Why hashtags and not the search API: /api/v2/search needs a user token on
// every current Mastodon version, which would reintroduce exactly the
// registration step this provider exists to avoid. The hashtag timeline
// (/api/v1/timelines/tag/:tag) and the trends endpoint are public on a default
// instance, so a workspace can discover fediverse communities from second one.
//
// A hashtag *is* the community here: it is the addressable thing people follow
// and post into. Its "member count" is therefore an activity magnitude (distinct
// accounts posting), not a subscriber number — the mapper is told so via
// `isTopicQuery: false` plus the descriptor's caveat, rather than by inventing
// a subscriber figure.
//
// Failure mode (mandatory): the fediverse has no uptime guarantee. One
// unreachable instance must degrade the sweep, never end it — every instance
// call is individually caught and timed out, partial results are returned, and
// the failure is recorded in `degradations` for the caller to log.

import {
  DEFAULT_MASTODON_INSTANCES,
  type CommunityRule,
  type DiscoveredCommunityCandidate,
  type DiscoveredThread,
  type DiscoveryProvider,
  type ProviderDegradation,
  type ThreadSearchOptions,
} from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';

const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = 'web:prolora:v1.0 (DACH feedback & publishing SaaS)';
const MAX_TIMELINE_LIMIT = 40;

interface MastodonAccount {
  acct?: string;
  display_name?: string;
}

interface MastodonStatus {
  id?: string;
  uri?: string;
  url?: string;
  created_at?: string;
  content?: string;
  spoiler_text?: string;
  language?: string | null;
  favourites_count?: number;
  reblogs_count?: number;
  replies_count?: number;
  account?: MastodonAccount;
}

interface MastodonTagHistory {
  day?: string;
  uses?: string;
  accounts?: string;
}

interface MastodonTag {
  name?: string;
  url?: string;
  history?: MastodonTagHistory[];
}

export class MastodonDiscoveryProvider implements DiscoveryProvider {
  readonly id: IntegrationProvider = 'mastodon';
  readonly capabilities = { findCommunities: true, readRules: false, scanThreads: true } as const;
  readonly degradations: ProviderDegradation[] = [];

  constructor(private readonly instances: readonly string[] = DEFAULT_MASTODON_INSTANCES) {}

  async searchCommunities(
    topics: string[],
    limit: number
  ): Promise<DiscoveredCommunityCandidate[]> {
    const wanted = topics.map(normalizeTag).filter(Boolean);
    if (wanted.length === 0) return [];

    const found = new Map<string, DiscoveredCommunityCandidate>();

    // Pass 1 — trending tags per instance, so discovery is not limited to the
    // literal words the LLM produced.
    const trending = await this.collectTrendingTags();
    for (const tag of trending) {
      const name = normalizeTag(tag.name ?? '');
      if (!name) continue;
      if (!wanted.some((topic) => name.includes(topic) || topic.includes(name))) continue;
      found.set(name, tagToCandidate(name, tag, this.instances[0] ?? 'mastodon.social'));
    }

    // Pass 2 — probe the topics themselves. A hashtag with recent posts exists,
    // whether or not it happens to be trending anywhere today.
    for (const topic of wanted) {
      if (found.has(topic)) continue;
      const statuses = await this.collectTimeline(topic, MAX_TIMELINE_LIMIT);
      if (statuses.length === 0) continue;
      const authors = new Set(statuses.map((status) => status.account?.acct ?? ''));
      found.set(topic, {
        externalId: topic,
        name: `#${topic}`,
        url: `https://${this.instances[0] ?? 'mastodon.social'}/tags/${topic}`,
        description: `Fediverse hashtag #${topic} — ${statuses.length} recent posts from ${authors.size} accounts.`,
        memberCount: authors.size,
        activeCount: authors.size,
        language: dominantLanguage(statuses),
        nsfw: false,
        isTopicQuery: false,
      });
    }

    return [...found.values()].sort((a, b) => b.memberCount - a.memberCount).slice(0, limit);
  }

  /**
   * Mastodon instances publish rules for the *instance*, never for a hashtag,
   * and a hashtag spans instances. There is no honest answer, so: null.
   */
  async getCommunityRules(): Promise<CommunityRule[] | null> {
    return null;
  }

  async searchThreads(
    externalId: string,
    query: string,
    opts: ThreadSearchOptions
  ): Promise<DiscoveredThread[]> {
    const tag = normalizeTag(externalId);
    if (!tag) return [];
    const statuses = await this.collectTimeline(tag, Math.min(opts.limit ?? 40, MAX_TIMELINE_LIMIT));
    const cutoff = cutoffSeconds(opts.time);
    const terms = queryTerms(query);

    return statuses
      .map((status) => toThread(status, tag))
      .filter((thread) => thread.createdAt >= cutoff)
      .filter((thread) => matchesTerms(thread, terms))
      .slice(0, opts.limit ?? 40);
  }

  async getHotThreads(externalId: string, limit: number): Promise<DiscoveredThread[]> {
    const tag = normalizeTag(externalId);
    if (!tag) return [];
    const statuses = await this.collectTimeline(tag, MAX_TIMELINE_LIMIT);
    return statuses
      .map((status) => toThread(status, tag))
      .sort((a, b) => engagement(b) - engagement(a))
      .slice(0, limit);
  }

  async getCommunityInfo(externalId: string): Promise<DiscoveredCommunityCandidate | null> {
    const tag = normalizeTag(externalId);
    if (!tag) return null;
    const statuses = await this.collectTimeline(tag, MAX_TIMELINE_LIMIT);
    if (statuses.length === 0) {
      // Every instance answered and none had a post: the hashtag is dormant.
      // A total outage is a different thing and is reported as degradation, so
      // the health check must not read it as "community gone".
      if (this.degradations.length === this.instances.length) return null;
      return {
        externalId: tag,
        name: `#${tag}`,
        url: `https://${this.instances[0] ?? 'mastodon.social'}/tags/${tag}`,
        description: `Fediverse hashtag #${tag}`,
        memberCount: 0,
        activeCount: 0,
        language: null,
        nsfw: false,
        isTopicQuery: false,
      };
    }
    const authors = new Set(statuses.map((status) => status.account?.acct ?? ''));
    return {
      externalId: tag,
      name: `#${tag}`,
      url: `https://${this.instances[0] ?? 'mastodon.social'}/tags/${tag}`,
      description: `Fediverse hashtag #${tag}`,
      memberCount: authors.size,
      activeCount: authors.size,
      language: dominantLanguage(statuses),
      nsfw: false,
      isTopicQuery: false,
    };
  }

  // --- instance fan-out ---

  private async collectTrendingTags(): Promise<MastodonTag[]> {
    const results = await Promise.all(
      this.instances.map((host) =>
        this.fetchJson<MastodonTag[]>(host, '/api/v1/trends/tags?limit=20')
      )
    );
    return results.flatMap((tags) => tags ?? []);
  }

  private async collectTimeline(tag: string, limit: number): Promise<MastodonStatus[]> {
    const results = await Promise.all(
      this.instances.map((host) =>
        this.fetchJson<MastodonStatus[]>(
          host,
          `/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`
        )
      )
    );

    // Federated copies of the same post appear on several instances; the AP URI
    // is the identity that survives that.
    const byUri = new Map<string, MastodonStatus>();
    for (const statuses of results) {
      for (const status of statuses ?? []) {
        const uri = status.uri ?? status.url;
        if (!uri || byUri.has(uri)) continue;
        byUri.set(uri, status);
      }
    }
    return [...byUri.values()];
  }

  /** Returns null instead of throwing — one dead instance is a degradation. */
  private async fetchJson<T>(host: string, path: string): Promise<T | null> {
    try {
      const response = await fetch(`https://${host}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.degrade(host, `HTTP ${response.status}`);
        return null;
      }
      const json: unknown = await response.json();
      return Array.isArray(json) ? (json as T) : null;
    } catch (error) {
      this.degrade(host, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private degrade(host: string, reason: string): void {
    if (this.degradations.some((entry) => entry.source === host)) return;
    this.degradations.push({ source: host, reason });
    console.error(`[discovery:mastodon] instance ${host} unavailable: ${reason}`);
  }
}

// --- pure helpers -----------------------------------------------------------

export function normalizeTag(value: string): string {
  return value
    .trim()
    .replace(/^#/, '')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .toLowerCase()
    .slice(0, 60);
}

/** Mastodon serves HTML; the LLM and the DB both want plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tagToCandidate(
  name: string,
  tag: MastodonTag,
  primaryInstance: string
): DiscoveredCommunityCandidate {
  const accounts = (tag.history ?? []).reduce(
    (sum, entry) => sum + (Number(entry.accounts) || 0),
    0
  );
  const uses = (tag.history ?? []).reduce((sum, entry) => sum + (Number(entry.uses) || 0), 0);
  return {
    externalId: name,
    name: `#${name}`,
    url: tag.url ?? `https://${primaryInstance}/tags/${name}`,
    description: `Trending fediverse hashtag — ${uses} posts from ${accounts} accounts in the last days.`,
    memberCount: accounts,
    activeCount: accounts,
    language: null,
    nsfw: false,
    isTopicQuery: false,
  };
}

function toThread(status: MastodonStatus, tag: string): DiscoveredThread {
  const body = stripHtml(status.content ?? '');
  const spoiler = (status.spoiler_text ?? '').trim();
  const firstLine = body.split('\n').find((line) => line.trim().length > 0) ?? '';
  return {
    externalId: status.uri ?? status.url ?? `mastodon:${status.id ?? ''}`,
    title: (spoiler || firstLine).slice(0, 160) || `#${tag} post`,
    body,
    author: status.account?.acct ?? '',
    communityName: `#${tag}`,
    url: status.url ?? status.uri ?? '',
    createdAt: status.created_at ? Math.floor(Date.parse(status.created_at) / 1000) || 0 : 0,
    score: status.favourites_count ?? 0,
    replies: status.replies_count ?? 0,
  };
}

function engagement(thread: DiscoveredThread): number {
  return thread.score + thread.replies * 3;
}

function dominantLanguage(statuses: MastodonStatus[]): string | null {
  const counts = new Map<string, number>();
  for (const status of statuses) {
    if (!status.language) continue;
    counts.set(status.language, (counts.get(status.language) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [language, count] of counts) {
    if (count > bestCount) {
      best = language;
      bestCount = count;
    }
  }
  return best;
}

/** Thread Radar hands over `a OR b OR c`; Mastodon has no server-side search. */
export function queryTerms(query: string): string[] {
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
    case 'week':
      return now - 7 * 86400;
    case 'day':
      return now - 86400;
    default:
      return 0;
  }
}
