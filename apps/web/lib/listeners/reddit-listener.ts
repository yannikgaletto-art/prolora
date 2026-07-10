import type { FeedbackSourceRow } from '@/lib/db';
import { getRedditClient, type RedditThread } from '@/lib/discovery/reddit-client';
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
// runs a keyword search (sort=new) via the shared app-only RedditClient and
// keeps only threads newer than the stored cursor (max created_utc seen).
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

    // Cursor = newest created_utc (seconds) already ingested.
    const cursorTs = parseCursor(source.last_poll_cursor);
    const client = getRedditClient();
    const seen = new Set<string>();
    const items: RawFeedbackItem[] = [];
    let maxTs = cursorTs ?? 0;
    let partial = false;

    for (const subreddit of config.subreddits) {
      let subredditCount = 0;
      for (const keyword of config.brand_keywords) {
        try {
          const threads = await client.searchThreads(subreddit, keyword, {
            time: 'week',
            limit: 100,
          });
          for (const thread of threads) {
            if (seen.has(thread.fullname)) continue;
            seen.add(thread.fullname);
            // Only new items beyond the cursor — dedupe against older runs.
            if (cursorTs !== null && thread.created_utc <= cursorTs) continue;
            if (thread.created_utc > maxTs) maxTs = thread.created_utc;
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

function threadToRawFeedbackItem(thread: RedditThread): RawFeedbackItem {
  const content = [thread.title, thread.selftext].filter(Boolean).join('\n\n').trim();
  return {
    source_external_id: thread.fullname,
    source_url: thread.permalink,
    author_name: thread.author || null,
    author_avatar: null,
    content,
    rating: null,
    source_date:
      thread.created_utc > 0 ? new Date(thread.created_utc * 1000).toISOString() : null,
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
