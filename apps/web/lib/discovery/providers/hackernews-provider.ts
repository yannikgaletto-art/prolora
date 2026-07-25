// Hacker News as a DiscoveryProvider — credentialKind 'none'.
//
// HN has no communities. There is no equivalent of a subreddit to join, no
// membership, no rules endpoint. Rather than fake one, this provider maps a
// *topic query* to a pseudo-community: `capabilities.findCommunities` is false,
// every candidate carries `isTopicQuery: true`, and the descriptor says so in
// the UI. What gets stored in discovery_communities is a saved search, and the
// product calls it that.
//
// Failure mode (mandatory): Algolia rate-limits by IP, so a scan can hit 429
// halfway through. Each request backs off twice; if it still fails the call
// returns whatever it already has and records a degradation. Nothing throws —
// the listener/radar invariant is that a partial result beats a dead run.

import type {
  CommunityRule,
  DiscoveredCommunityCandidate,
  DiscoveredThread,
  DiscoveryProvider,
  ProviderDegradation,
  ThreadSearchOptions,
} from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';

const API = 'https://hn.algolia.com/api/v1';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 400;
const RECENT_WINDOW_SECONDS = 30 * 24 * 3600;

interface AlgoliaHit {
  objectID?: string;
  title?: string;
  story_title?: string;
  url?: string;
  story_text?: string;
  comment_text?: string;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at_i?: number;
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[];
  nbHits?: number;
}

export class HackerNewsDiscoveryProvider implements DiscoveryProvider {
  readonly id: IntegrationProvider = 'hackernews';
  readonly capabilities = { findCommunities: false, readRules: false, scanThreads: true } as const;
  readonly degradations: ProviderDegradation[] = [];

  /** Injectable so tests can drive backoff without real timers. */
  constructor(private readonly sleep: (ms: number) => Promise<void> = defaultSleep) {}

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

      const response = await this.request(
        `/search?tags=story&hitsPerPage=20&query=${encodeURIComponent(topic)}`,
        topic
      );
      // Rate limited or unreachable: keep the topics already collected instead
      // of losing the whole sweep.
      if (!response) continue;

      const hits = response.hits ?? [];
      if (hits.length === 0) continue;

      const cutoff = Math.floor(Date.now() / 1000) - RECENT_WINDOW_SECONDS;
      const recent = hits.filter((hit) => (hit.created_at_i ?? 0) >= cutoff).length;

      candidates.push({
        externalId: topic,
        name: `HN topic: "${topic}"`,
        url: `https://hn.algolia.com/?query=${encodeURIComponent(topic)}&type=story`,
        description:
          `Saved Hacker News search. Hacker News has no communities — this tracks the topic itself. ` +
          `${response.nbHits ?? hits.length} matching stories, ${recent} in the last 30 days.`,
        memberCount: response.nbHits ?? hits.length,
        activeCount: recent,
        language: 'en',
        nsfw: false,
        isTopicQuery: true,
      });
    }

    return candidates;
  }

  /** HN has no rules API. `null`, never a throw (Vertrag C2). */
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

    const cutoff = cutoffSeconds(opts.time);
    const limit = Math.min(opts.limit ?? 50, 100);
    const filter = cutoff > 0 ? `&numericFilters=created_at_i>${cutoff}` : '';
    const response = await this.request(
      `/search_by_date?tags=story&hitsPerPage=${limit}&query=${encodeURIComponent(topic)}${filter}`,
      topic
    );
    if (!response) return [];

    const terms = queryTerms(query);
    return (response.hits ?? [])
      .map((hit) => toThread(hit, topic))
      .filter((thread) => matchesTerms(thread, terms));
  }

  async getHotThreads(externalId: string, limit: number): Promise<DiscoveredThread[]> {
    const topic = normalizeTopic(externalId);
    if (!topic) return [];
    const response = await this.request(
      `/search?tags=story&hitsPerPage=${Math.min(limit, 50)}&query=${encodeURIComponent(topic)}`,
      topic
    );
    if (!response) return [];
    return (response.hits ?? []).map((hit) => toThread(hit, topic));
  }

  /**
   * A saved search cannot go away — only go quiet. Returning a refreshed
   * magnitude keeps the health check from deactivating a working topic.
   */
  async getCommunityInfo(externalId: string): Promise<DiscoveredCommunityCandidate | null> {
    const [candidate] = await this.searchCommunities([externalId], 1);
    return candidate ?? null;
  }

  /** Returns null on give-up instead of throwing. */
  private async request(path: string, source: string): Promise<AlgoliaResponse | null> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${API}${path}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (response.status === 429) {
          if (attempt === MAX_RETRIES) {
            this.degrade(source, 'Algolia rate limit (429) — partial results');
            return null;
          }
          await this.sleep(BASE_BACKOFF_MS * 2 ** attempt);
          continue;
        }
        if (!response.ok) {
          this.degrade(source, `HTTP ${response.status}`);
          return null;
        }
        return (await response.json()) as AlgoliaResponse;
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          this.degrade(source, error instanceof Error ? error.message : String(error));
          return null;
        }
        await this.sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }
    return null;
  }

  private degrade(source: string, reason: string): void {
    if (this.degradations.some((entry) => entry.source === source)) return;
    this.degradations.push({ source, reason });
    console.error(`[discovery:hackernews] "${source}" degraded: ${reason}`);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeTopic(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 120);
}

function toThread(hit: AlgoliaHit, topic: string): DiscoveredThread {
  const id = hit.objectID ?? '';
  return {
    externalId: `hn_${id}`,
    title: hit.title ?? hit.story_title ?? '(untitled)',
    body: hit.story_text ?? hit.comment_text ?? hit.url ?? '',
    author: hit.author ?? '',
    communityName: `HN topic: "${topic}"`,
    url: `https://news.ycombinator.com/item?id=${id}`,
    createdAt: hit.created_at_i ?? 0,
    score: hit.points ?? 0,
    replies: hit.num_comments ?? 0,
  };
}

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
    case 'day':
      return now - 86400;
    case 'week':
      return now - 7 * 86400;
    default:
      return 0;
  }
}
