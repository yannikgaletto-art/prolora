import { createHmac, randomUUID } from 'crypto';
import { inngest } from '../client';
import { getServiceDb, type PostItemRow, type WebhookRow } from '@/lib/db';
import { getValidToken } from '@/lib/auth/token-manager';
import { createAdapter } from '@/lib/adapters';
import { PlatformError } from '@/lib/adapters/types';
import { decrypt } from '@/lib/auth/encryption';

const WEBHOOK_TIMEOUT_MS = 10_000;
const WEBHOOK_DISABLE_AFTER_FAILURES = 10;

export const collectMetrics = inngest.createFunction(
  {
    id: 'collect-metrics',
    retries: 2,
    concurrency: [{ limit: 10 }],
  },
  { event: 'metrics/collect' },
  async ({ event, step }) => {
    return step.run('fetch-platform-metrics', async () => {
      const { postItemId } = event.data;
      const db = getServiceDb();

      const { data: item, error } = await db
        .from('post_items')
        .select('*')
        .eq('id', postItemId)
        .maybeSingle<PostItemRow>();
      if (error) throw new Error(`[collect-metrics] item load failed: ${error.message}`);
      if (!item || item.status !== 'published' || !item.platform_post_id) {
        return { collected: false, reason: 'item is not published' };
      }

      try {
        const { token, connection } = await getValidToken(item.connection_id);
        const adapter = createAdapter(connection.platform);
        const metrics = await adapter.getPostMetrics(item.platform_post_id, token);

        const { error: updateError } = await db
          .from('post_items')
          .update({
            metrics: {
              likes: metrics.likes,
              shares: metrics.shares,
              comments: metrics.comments,
              ...(metrics.impressions !== undefined ? { impressions: metrics.impressions } : {}),
              ...(metrics.clicks !== undefined ? { clicks: metrics.clicks } : {}),
            },
            metrics_updated_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        if (updateError) {
          throw new Error(`[collect-metrics] metrics write failed: ${updateError.message}`);
        }
        return { collected: true };
      } catch (metricsError) {
        if (metricsError instanceof PlatformError && !metricsError.retryable) {
          // Metrics are best-effort — a dead token here must not spin retries.
          console.error(`[collect-metrics] unrecoverable for ${postItemId}:`, metricsError.message);
          return { collected: false, reason: metricsError.message };
        }
        throw metricsError;
      }
    });
  }
);

export const scheduledMetricsCollection = inngest.createFunction(
  {
    id: 'scheduled-metrics-collection',
    retries: 1,
  },
  { cron: '0 */4 * * *' },
  async ({ step }) => {
    const items = await step.run('find-published-posts', async () => {
      const db = getServiceDb();
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await db
        .from('post_items')
        .select('id')
        .eq('status', 'published')
        .gte('published_at', cutoff)
        .limit(500)
        .returns<Array<Pick<PostItemRow, 'id'>>>();
      if (error) throw new Error(`[scheduled-metrics] query failed: ${error.message}`);
      return (data ?? []).map((row) => row.id);
    });

    if (items.length > 0) {
      await step.sendEvent(
        'fan-out-metrics',
        items.map((postItemId) => ({ name: 'metrics/collect' as const, data: { postItemId } }))
      );
    }
    return { scheduled: items.length };
  }
);

export const fireWebhooks = inngest.createFunction(
  {
    id: 'fire-webhooks',
    retries: 5,
  },
  { event: 'webhooks/fire' },
  async ({ event, step }) => {
    const { workspaceId, event: eventType, payload } = event.data;

    return step.run('deliver-webhooks', async () => {
      const db = getServiceDb();
      const { data: webhooks, error } = await db
        .from('webhooks')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('active', true)
        .contains('events', [eventType])
        .returns<WebhookRow[]>();
      if (error) throw new Error(`[fire-webhooks] query failed: ${error.message}`);

      const body = JSON.stringify({
        event: eventType,
        created_at: new Date().toISOString(),
        workspace_id: workspaceId,
        data: payload,
      });

      let delivered = 0;
      let failed = 0;

      for (const webhook of webhooks ?? []) {
        // Secret is encrypted at rest (Invariante 1) — decrypt to sign.
        const secret = decrypt(webhook.secret_encrypted);
        const signature = createHmac('sha256', secret).update(body).digest('hex');

        let success = false;
        try {
          const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Prolora-Signature': `sha256=${signature}`,
              'X-Prolora-Event': eventType,
              'X-Prolora-Delivery': randomUUID(),
            },
            body,
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
          });
          success = response.status >= 200 && response.status < 300;
        } catch (deliveryError) {
          console.error(`[fire-webhooks] delivery to ${webhook.url} failed:`, deliveryError);
        }

        if (success) {
          delivered++;
          const { error: okError } = await db
            .from('webhooks')
            .update({ failure_count: 0, last_triggered_at: new Date().toISOString() })
            .eq('id', webhook.id);
          if (okError) console.error('[fire-webhooks] success write failed:', okError.message);
        } else {
          failed++;
          const newCount = webhook.failure_count + 1;
          const { error: failError } = await db
            .from('webhooks')
            .update({
              failure_count: newCount,
              // 10 consecutive failures -> the endpoint is dead, stop trying.
              ...(newCount >= WEBHOOK_DISABLE_AFTER_FAILURES ? { active: false } : {}),
            })
            .eq('id', webhook.id);
          if (failError) console.error('[fire-webhooks] failure write failed:', failError.message);
          if (newCount >= WEBHOOK_DISABLE_AFTER_FAILURES) {
            console.error(
              `[fire-webhooks] webhook ${webhook.id} disabled after ${newCount} consecutive failures`
            );
          }
        }
      }

      return { delivered, failed, total: (webhooks ?? []).length };
    });
  }
);

export const dailyDigest = inngest.createFunction(
  {
    id: 'daily-digest',
    retries: 1,
  },
  { cron: '0 8 * * *' },
  async ({ step }) => {
    return step.run('generate-digests', async () => {
      // Email delivery (Resend) is not part of the backend scope yet —
      // graceful no-op instead of a crashing cron.
      if (!process.env.RESEND_API_KEY) {
        return { sent: 0, skipped: 'RESEND_API_KEY not configured' };
      }
      console.log('[daily-digest] Resend configured but digest templates are not implemented yet');
      return { sent: 0, skipped: 'digest templates not implemented' };
    });
  }
);

export const notifyVoters = inngest.createFunction(
  {
    id: 'notify-voters',
    retries: 2,
  },
  { event: 'board/notify-voters' },
  async ({ event, step }) => {
    return step.run('send-notifications', async () => {
      const { boardItemId, newStatus } = event.data;
      const db = getServiceDb();

      // boardItemId is the workspace-verified primary key carried by the
      // event (fired only after a scoped update in board-service).
      const { data: item, error: itemError } = await db
        .from('board_items')
        .select('id, title, workspace_id')
        .eq('id', boardItemId)
        .maybeSingle<{ id: string; title: string; workspace_id: string }>();
      if (itemError) throw new Error(`[board] notify-voters item load failed: ${itemError.message}`);
      if (!item) {
        return { notified: 0, skipped: true, reason: 'board item not found' };
      }

      const { data: votes, error: votesError } = await db
        .from('board_votes')
        .select('voter_email')
        .eq('board_item_id', item.id)
        .not('voter_email', 'is', null)
        .returns<Array<{ voter_email: string | null }>>();
      if (votesError) throw new Error(`[board] notify-voters votes load failed: ${votesError.message}`);

      const emails = [
        ...new Set(
          (votes ?? [])
            .map((v) => v.voter_email)
            .filter((email): email is string => Boolean(email))
        ),
      ];

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.log('[board] notification skipped: no email provider');
        return { notified: 0, skipped: true };
      }
      if (emails.length === 0) {
        return { notified: 0, skipped: false };
      }

      const statusLabel = newStatus.replace(/_/g, ' ');
      let notified = 0;
      for (const email of emails) {
        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: process.env.BOARD_NOTIFY_FROM_EMAIL ?? 'Prolora <notifications@prolora.app>',
              to: [email],
              subject: `Update: "${item.title}" is now ${statusLabel}`,
              text: `Good news! A feedback item you voted for has a new status.\n\n"${item.title}" is now: ${statusLabel}.\n\nThanks for your feedback!`,
            }),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
          });
          if (response.ok) {
            notified++;
          } else {
            console.error(`[board] notify email failed: HTTP ${response.status}`);
          }
        } catch (sendError) {
          // Per-email failures must never crash the whole notification run.
          console.error(
            `[board] notify email failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`
          );
        }
      }

      return { notified, skipped: false, total: emails.length };
    });
  }
);
