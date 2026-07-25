// Daily health *classification* — the layer above the live probe.
//
// This is deliberately not a second `tokenHealthCheck`. That function
// (token-lifecycle.ts, every 6h) talks to every platform, writes
// `last_health_check` and owns the advisory-lock refresh; duplicating any of
// that would mean two writers for one column and twice the API calls against a
// user's rate budget. This one makes no network call at all: it re-reads what
// the probe already stored, classifies it into the four states the UI and the
// capacity layer speak (lib/connections/health.ts), and emits an event when the
// classification says more than the row's own `status` column does.
//
// Daily is the right cadence because the only thing it can discover that the
// 6-hourly probe cannot is "this token expires within a week" — a warning whose
// value is measured in days. It re-fires while a divergence persists, which is
// intended: an expiry warning that stops after one send is a warning nobody
// sees.

import { inngest } from '../client';
import { CONNECTION_ROW_COLUMNS, getServiceDb, type ConnectionRow } from '@/lib/db';
import { classifyConnectionHealth, shouldRequestRefresh } from '@/lib/connections/health';

export const connectionHealthMonitor = inngest.createFunction(
  {
    id: 'connection-health-monitor',
    retries: 1,
  },
  { cron: '0 6 * * *' },
  async ({ step }) => {
    const summary = await step.run('classify-connections', async () => {
      const db = getServiceDb();
      const { data: workspaces, error: workspaceError } = await db
        .from('workspaces')
        .select('id')
        .returns<Array<{ id: string }>>();
      if (workspaceError) {
        throw new Error(`[connection-health] workspace query failed: ${workspaceError.message}`);
      }

      const counts = { healthy: 0, expiring_soon: 0, expired: 0, revoked: 0 };
      const changes: Array<{
        connectionId: string;
        workspaceId: string;
        platform: string;
        state: keyof typeof counts;
        previousState: keyof typeof counts;
        tokenExpiresAt: string | null;
        expiresInDays: number | null;
      }> = [];
      const refreshDue: Array<{ connectionId: string; workspaceId: string }> = [];

      for (const workspace of workspaces ?? []) {
        // Invariante 2: explicit workspace_id filter, column allowlist, no '*'.
        const { data, error } = await db
          .from('platform_connections')
          .select(CONNECTION_ROW_COLUMNS)
          .eq('workspace_id', workspace.id)
          .returns<ConnectionRow[]>();
        if (error) throw new Error(`[connection-health] query failed: ${error.message}`);

        const now = new Date();
        for (const row of data ?? []) {
          const health = classifyConnectionHealth(row, now);
          counts[health.state] += 1;

          if (health.state !== health.previousState) {
            changes.push({
              connectionId: health.connectionId,
              workspaceId: workspace.id,
              platform: health.platform,
              state: health.state,
              previousState: health.previousState,
              tokenExpiresAt: health.tokenExpiresAt,
              expiresInDays: health.expiresInDays,
            });
          }

          if (shouldRequestRefresh(health)) {
            refreshDue.push({ connectionId: health.connectionId, workspaceId: workspace.id });
          }
        }
      }

      return { counts, changes, refreshDue };
    });

    if (summary.changes.length > 0) {
      await step.sendEvent(
        'emit-health-changed',
        summary.changes.map((change) => ({
          name: 'connection/health-changed' as const,
          data: change,
        }))
      );
    }

    // The refresh itself stays where it lives (FABLE-01 advisory lock in
    // token-manager). This monitor only asks for it.
    if (summary.refreshDue.length > 0) {
      await step.sendEvent(
        'request-token-refresh',
        summary.refreshDue.map((connection) => ({
          name: 'tokens/refresh' as const,
          data: connection,
        }))
      );
    }

    return {
      ...summary.counts,
      changed: summary.changes.length,
      refreshRequested: summary.refreshDue.length,
    };
  }
);
