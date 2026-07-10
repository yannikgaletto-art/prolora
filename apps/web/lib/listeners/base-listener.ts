import { getServiceDb, type FeedbackSourceRow } from '@/lib/db';

// One normalized feedback item as produced by a listener. Maps 1:1 onto the
// raw_feedback columns it fills (workspace_id/source_id/source_platform are
// added at insert time).
export interface RawFeedbackItem {
  source_external_id: string;
  source_url: string | null;
  author_name: string | null;
  author_avatar: string | null;
  content: string;
  rating: number | null;
  source_date: string | null;
}

// What a concrete listener implementation returns: the items it fetched plus
// the cursor to persist in feedback_sources.last_poll_cursor. Listeners keep
// the old cursor when a poll was partial (rate limit / per-keyword errors) so
// the next cron run re-fetches — the DB UNIQUE constraint dedupes.
export interface ListenerPollOutcome {
  items: RawFeedbackItem[];
  nextCursor: string | null;
}

// Base class for all feedback listeners. Guarantees Invariante 4: poll()
// NEVER throws — any error is logged as a structured message and results in
// an empty batch (the next cron run silently retries).
export abstract class BaseListener {
  // Used for logging ('[listener:{type}] ...') and as raw_feedback.source_platform.
  abstract readonly sourceType: string;

  protected abstract pollSource(source: FeedbackSourceRow): Promise<ListenerPollOutcome>;

  private lastCursor: string | null = null;

  async poll(source: FeedbackSourceRow): Promise<RawFeedbackItem[]> {
    this.lastCursor = source.last_poll_cursor;
    try {
      const outcome = await this.pollSource(source);
      this.lastCursor = outcome.nextCursor;
      return outcome.items;
    } catch (error) {
      console.error(
        `[listener:${this.sourceType}] poll failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  // Cursor produced by the most recent poll() call. Falls back to the
  // source's previous cursor when the poll failed (never lose position,
  // never skip items).
  get nextCursor(): string | null {
    return this.lastCursor;
  }
}

export interface InsertRawFeedbackResult {
  // ids of rows that were actually NEW (duplicates are silently ignored via
  // the UNIQUE(workspace_id, source_platform, source_external_id) constraint).
  insertedIds: string[];
  // false when the insert itself failed — callers must NOT advance the
  // cursor in that case so the next run retries.
  ok: boolean;
}

// Shared dedupe-safe insert for all listeners. Uses upsert with
// ignoreDuplicates so re-polled items never error (23505) and never create
// duplicates; only genuinely new rows are returned.
export async function insertRawFeedbackItems(
  workspaceId: string,
  sourceId: string | null,
  sourcePlatform: string,
  items: RawFeedbackItem[]
): Promise<InsertRawFeedbackResult> {
  if (items.length === 0) {
    return { insertedIds: [], ok: true };
  }

  const db = getServiceDb();
  const payload = items.map((item) => ({
    workspace_id: workspaceId,
    source_id: sourceId,
    source_platform: sourcePlatform,
    source_url: item.source_url,
    source_external_id: item.source_external_id,
    author_name: item.author_name,
    author_avatar: item.author_avatar,
    content: item.content,
    rating: item.rating,
    source_date: item.source_date,
    processed: false,
  }));

  const { data, error } = await db
    .from('raw_feedback')
    .upsert(payload, {
      onConflict: 'workspace_id,source_platform,source_external_id',
      ignoreDuplicates: true,
    })
    .select('id')
    .returns<Array<{ id: string }>>();

  if (error) {
    console.error(`[listener:${sourcePlatform}] raw_feedback insert failed: ${error.message}`);
    return { insertedIds: [], ok: false };
  }

  return { insertedIds: (data ?? []).map((row) => row.id), ok: true };
}
