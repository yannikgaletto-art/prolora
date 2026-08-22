import { inngest } from '@/lib/inngest/client';
import { runWriter } from '@/lib/writer/run';
import { isAutomationEnabled } from '@/lib/system/kill-switch';

// Event-only during the pilot. No cron is registered until Canary approval.
// Retries stay disabled because a repeated LLM step can consume fresh credits;
// the underlying signal uniqueness fence handles explicit user retries.
export const writerRun = inngest.createFunction(
  {
    id: 'writer-run',
    retries: 0,
    concurrency: [{ limit: 1, key: 'event.data.workspaceId' }],
  },
  { event: 'writer/run' },
  async ({ event, step }) => {
    if (!(await isAutomationEnabled())) return { skipped: true, reason: 'automation disabled' };

    return step.run('bounded-writer-run', () =>
      runWriter({
        workspaceId: event.data.workspaceId,
        mode: event.data.mode,
        languages: event.data.outputLanguages,
        productMentionMode: event.data.productMentionMode,
      })
    );
  }
);
