import { inngest } from '../client';
import { getServiceDb, type FeedbackSourceRow } from '@/lib/db';
import { BaseListener, insertRawFeedbackItems } from '@/lib/listeners/base-listener';
import { RedditListener } from '@/lib/listeners/reddit-listener';

const MAX_SOURCES_PER_RUN = 200;

// 'widget' is push-based (public route), it is never polled.
function listenerFor(sourceType: string): BaseListener | null {
  switch (sourceType) {
    case 'reddit':
      return new RedditListener();
    default:
      return null;
  }
}

interface PollEventData {
  workspaceId?: string;
  sourceId?: string;
}

// Polls every active feedback source. Runs on a 30-minute cron for ALL
// workspaces, or on demand via 'feedback/poll' (optionally narrowed to one
// workspace/source). Per-source failures are logged and skipped — one broken
// source must never stall the others (Invariante 4).
export const pollFeedbackSources = inngest.createFunction(
  {
    id: 'poll-feedback-sources',
    retries: 1,
    concurrency: [{ limit: 1 }],
  },
  [{ cron: '*/30 * * * *' }, { event: 'feedback/poll' }],
  async ({ event, step }) => {
    // Cron invocations carry no event data.
    const filter: PollEventData =
      event?.name === 'feedback/poll' ? ((event.data ?? {}) as PollEventData) : {};

    const sources = await step.run('load-active-sources', async () => {
      const db = getServiceDb();
      let builder = db.from('feedback_sources').select('*').eq('status', 'active');
      if (filter.workspaceId) builder = builder.eq('workspace_id', filter.workspaceId);
      if (filter.sourceId) builder = builder.eq('id', filter.sourceId);

      const { data, error } = await builder
        .order('created_at', { ascending: true })
        .limit(MAX_SOURCES_PER_RUN)
        .returns<FeedbackSourceRow[]>();
      if (error) throw new Error(`[poll-sources] source query failed: ${error.message}`);
      return data ?? [];
    });

    const perWorkspace = new Map<string, { sources: number; newItems: number }>();
    const processEvents: Array<{
      name: 'feedback/process';
      data: { rawFeedbackId: string; workspaceId: string };
    }> = [];

    for (const source of sources) {
      const result = await step.run(`poll-source-${source.id}`, async () => {
        try {
          const listener = listenerFor(source.source_type);
          if (!listener) {
            if (source.source_type !== 'widget') {
              console.error(
                `[poll-sources] unknown source_type '${source.source_type}' for source ${source.id} — skipped`
              );
            }
            return { newIds: [] as string[], polled: false };
          }

          // poll() never throws (base listener contract).
          const items = await listener.poll(source);
          const inserted = await insertRawFeedbackItems(
            source.workspace_id,
            source.id,
            listener.sourceType,
            items
          );

          const db = getServiceDb();
          const update: Record<string, unknown> = { last_polled_at: new Date().toISOString() };
          // Only advance the cursor when the batch is durably stored —
          // otherwise the next run must re-fetch (feedback is never lost).
          if (inserted.ok) update.last_poll_cursor = listener.nextCursor;

          const { error: updateError } = await db
            .from('feedback_sources')
            .update(update)
            .eq('id', source.id)
            .eq('workspace_id', source.workspace_id);
          if (updateError) {
            console.error(
              `[poll-sources] cursor update failed for source ${source.id}: ${updateError.message}`
            );
          }

          return { newIds: inserted.insertedIds, polled: true };
        } catch (error) {
          console.error(
            `[poll-sources] source ${source.id} failed: ${error instanceof Error ? error.message : String(error)}`
          );
          return { newIds: [] as string[], polled: false };
        }
      });

      const stats = perWorkspace.get(source.workspace_id) ?? { sources: 0, newItems: 0 };
      if (result.polled) stats.sources += 1;
      stats.newItems += result.newIds.length;
      perWorkspace.set(source.workspace_id, stats);

      for (const rawFeedbackId of result.newIds) {
        processEvents.push({
          name: 'feedback/process',
          data: { rawFeedbackId, workspaceId: source.workspace_id },
        });
      }
    }

    for (const [workspaceId, stats] of perWorkspace) {
      console.log(
        `[poll-sources] workspace ${workspaceId}: ${stats.sources} sources polled, ${stats.newItems} new items`
      );
    }

    if (processEvents.length > 0) {
      await step.sendEvent('fan-out-feedback-process', processEvents);
    }

    return {
      sources: sources.length,
      newItems: processEvents.length,
    };
  }
);
