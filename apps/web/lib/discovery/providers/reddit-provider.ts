// Reddit as a DiscoveryProvider (Vertrag C2).
//
// Thin: RedditClient already speaks Reddit, this only reshapes its rows into the
// provider-neutral candidate/thread types so the discovery core no longer has a
// direct dependency on any one platform. Reddit is the only provider that can
// answer all three capabilities — everything else degrades somewhere, which is
// exactly why the capability flags exist.

import type {
  CommunityRule,
  DiscoveredCommunityCandidate,
  DiscoveredThread,
  DiscoveryProvider,
  ThreadSearchOptions,
} from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';
import type { RedditClient, RedditSubreddit, RedditThread } from '../reddit-client';

/** `r/saas` and `saas` both address the same subreddit — store the bare name. */
export function toSubredditName(externalId: string): string {
  return externalId.replace(/^\/?r\//i, '').replace(/\/$/, '');
}

export class RedditDiscoveryProvider implements DiscoveryProvider {
  readonly id: IntegrationProvider = 'reddit';
  readonly capabilities = { findCommunities: true, readRules: true, scanThreads: true } as const;

  constructor(private readonly client: RedditClient) {}

  async searchCommunities(
    topics: string[],
    limit: number
  ): Promise<DiscoveredCommunityCandidate[]> {
    const byName = new Map<string, DiscoveredCommunityCandidate>();
    for (const topic of topics) {
      try {
        const results = await this.client.searchSubreddits(topic, Math.min(limit, 25));
        for (const sub of results) {
          const candidate = toCandidate(sub);
          if (!byName.has(candidate.externalId)) byName.set(candidate.externalId, candidate);
        }
      } catch (error) {
        console.error(`[discovery:reddit] search for "${topic}" failed:`, error);
      }
    }
    return [...byName.values()].sort((a, b) => b.memberCount - a.memberCount).slice(0, limit);
  }

  async getCommunityRules(externalId: string): Promise<CommunityRule[] | null> {
    try {
      const rules = await this.client.getSubredditRules(toSubredditName(externalId));
      return rules.map((rule) => ({
        shortName: rule.short_name,
        description: rule.description,
      }));
    } catch (error) {
      // A failed fetch is "unknown", not "no rules" — same null, and the caller
      // treats both as "rules unavailable" rather than as a hard failure.
      console.error(`[discovery:reddit] rules for ${externalId} unavailable:`, error);
      return null;
    }
  }

  async searchThreads(
    externalId: string,
    query: string,
    opts: ThreadSearchOptions
  ): Promise<DiscoveredThread[]> {
    const threads = await this.client.searchThreads(toSubredditName(externalId), query, {
      time: opts.time ?? 'day',
      limit: opts.limit ?? 100,
    });
    return threads.map(toThread);
  }

  async getHotThreads(externalId: string, limit: number): Promise<DiscoveredThread[]> {
    const threads = await this.client.getHotThreads(toSubredditName(externalId), limit);
    return threads.map(toThread);
  }

  async getCommunityInfo(externalId: string): Promise<DiscoveredCommunityCandidate | null> {
    const about = await this.client.getSubredditAbout(toSubredditName(externalId));
    return toCandidate(about);
  }
}

function toCandidate(sub: RedditSubreddit): DiscoveredCommunityCandidate {
  return {
    externalId: sub.display_name,
    name: `r/${sub.display_name}`,
    url: sub.url,
    description: sub.public_description,
    memberCount: sub.subscribers,
    activeCount: sub.active_user_count,
    language: sub.lang,
    nsfw: sub.over18,
    isTopicQuery: false,
  };
}

function toThread(thread: RedditThread): DiscoveredThread {
  return {
    externalId: thread.fullname,
    title: thread.title,
    body: thread.selftext,
    author: thread.author,
    communityName: `r/${thread.subreddit}`,
    url: thread.permalink,
    createdAt: thread.created_utc,
    score: thread.score,
    replies: thread.num_comments,
  };
}
