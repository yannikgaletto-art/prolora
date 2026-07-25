import type { FeedbackSourceRow } from '@/lib/db';
import type { DiscoveredThread } from '@/lib/integrations/registry';
import { getDiscoveryProvider } from '@/lib/discovery/providers';
import {
  BaseListener,
  type ListenerPollOutcome,
  type RawFeedbackItem,
} from './base-listener';

// feedback_sources.config shape for source_type 'reddit'
interface RedditSourceConfig {
  subreddits: string[];
  brand_keywords: string[];
}

// Polls Reddit for brand mentions: for every subreddit x keyword pair it
// runs a keyword search (sort=new) through the Reddit DiscoveryProvider and
// keeps only threads newer than the stored cursor (max created timestamp seen).
//
// It talks to the provider rather than to RedditClient so that "which Reddit
// credentials does this workspace use" stays one decision in one place — the
// same one Discover makes.
export class RedditListener extends BaseListener {
  readonly sourceType = 'reddit';

  protected async pollSource(source: FeedbackSourceRow): Promise<ListenerPollOutcome> {
    const config = parseConfig(source.config);
    if (!config) {
      console.error(
        `[listener:reddit] source ${source.id} has invalid config (need subreddits[] + brand_keywords[])`
      );
      return { items: [], nextCursor: source.last_poll_cursor };
    }

    // Cursor = newest created timestamp (seconds) already ingested.
    const cursorTs = parseCursor(source.last_poll_cursor);
    const provider = await getDiscoveryProvider(source.workspace_id, 'reddit');
    const seen = new Set<string>();
    const items: RawFeedbackItem[] = [];
    let maxTs = cursorTs ?? 0;
    let partial = false;

    for (const subreddit of config.subreddits) {
      let subredditCount = 0;
      for (const keyword of config.brand_keywords) {
        try {
          const threads = await provider.searchThreads(subreddit, keyword, {
            time: 'week',
            limit: 100,
          });
          for (const thread of threads) {
            if (seen.has(thread.externalId)) continue;
            seen.add(thread.externalId);
            // Only new items beyond the cursor — dedupe against older runs.
            if (cursorTs !== null && thread.createdAt <= cursorTs) continue;
            if (thread.createdAt > maxTs) maxTs = thread.createdAt;
            items.push(threadToRawFeedbackItem(thread));
            subredditCount += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          partial = true;
          if (message.toLowerCase().includes('rate limit')) {
            // Invariante 5: back off silently — the next cron run picks up
            // where the (unchanged) cursor left off.
            console.error(`[listener:reddit] rate limited, returning partial batch: ${message}`);
            return { items, nextCursor: source.last_poll_cursor };
          }
          console.error(
            `[listener:reddit] search failed for r/${subreddit} q="${keyword}": ${message}`
          );
        }
      }
      console.log(`[listener:reddit] polled ${subredditCount} items from ${subreddit}`);
    }

    // Advance the cursor only after a complete pass; on partial results keep
    // the old cursor so nothing between the gaps is skipped (the DB UNIQUE
    // constraint absorbs the re-fetch).
    const nextCursor = partial
      ? source.last_poll_cursor
      : maxTs > 0
        ? String(maxTs)
        : source.last_poll_cursor;
    return { items, nextCursor };
  }
}

function threadToRawFeedbackItem(thread: DiscoveredThread): RawFeedbackItem {
  const content = [thread.title, thread.body].filter(Boolean).join('\n\n').trim();
  return {
    source_external_id: thread.externalId,
    source_url: thread.url,
    author_name: thread.author || null,
    author_avatar: null,
    content,
    rating: null,
    source_date: thread.createdAt > 0 ? new Date(thread.createdAt * 1000).toISOString() : null,
  };
}

function parseConfig(config: Record<string, unknown>): RedditSourceConfig | null {
  const subreddits = stringArray(config.subreddits);
  const keywords = stringArray(config.brand_keywords);
  if (!subreddits || subreddits.length === 0 || !keywords || keywords.length === 0) {
    return null;
  }
  return { subreddits, brand_keywords: keywords };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return strings.length === value.length ? strings : null;
}

function parseCursor(cursor: string | null): number | null {
  if (!cursor) return null;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
