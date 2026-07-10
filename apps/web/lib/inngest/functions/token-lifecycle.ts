import { inngest } from '../client';
import { getServiceDb, type ConnectionRow } from '@/lib/db';
import {
  refreshConnectionToken,
  buildTokenInfo,
  needsRefresh,
  markConnectionExpired,
} from '@/lib/auth/token-manager';
import { createAdapter } from '@/lib/adapters';
import { PlatformError } from '@/lib/adapters/types';

export const refreshTokens = inngest.createFunction(
  {
    id: 'refresh-tokens',
    retries: 3,
    concurrency: [{ limit: 1, key: 'event.data.connectionId' }],
  },
  { event: 'tokens/refresh' },
  async ({ event, step }) => {
    const { connectionId } = event.data;

    return step.run('acquire-lock-and-refresh', async () => {
      try {
        const outcome = await refreshConnectionToken(connectionId);
        return { connectionId, ...outcome };
      } catch (error) {
        if (error instanceof PlatformError && !error.retryable) {
          // AUTH_REVOKED etc. — token-manager already set status='expired'
          // and failed pending posts. Retrying cannot help.
          console.error(`[refresh-tokens] unrecoverable for ${connectionId}: ${error.message}`);
          return { connectionId, refreshed: false, reason: 'unrecoverable' as const };
        }
        throw error; // transient -> Inngest retry
      }
    });
  }
);

export const tokenHealthCheck = inngest.createFunction(
  {
    id: 'token-health-check',
    retries: 1,
  },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const summary = await step.run('check-all-connections', async () => {
      const db = getServiceDb();
      const { data, error } = await db
        .from('platform_connections')
        .select('*')
        .eq('status', 'active')
        .returns<ConnectionRow[]>();
      if (error) throw new Error(`[token-health-check] query failed: ${error.message}`);

      const counts = { checked: 0, healthy: 0, expired: 0, unknown: 0 };
      const refreshDue: string[] = [];

      for (const connection of data ?? []) {
        counts.checked += 1;
        const startedAt = Date.now();
        let healthy: boolean | null = null;

        try {
          const token = buildTokenInfo(connection);
          const adapter = createAdapter(connection.platform);
          healthy = await adapter.verifyCredentials(token);
        } catch (error) {
          // Network/platform errors: unknown state — keep the connection
          // active, record the failure, let the next run decide.
          console.error(
            `[token-health-check] check errored for ${connection.id} (${connection.platform}):`,
            error instanceof Error ? error.message : error
          );
        }

        const latencyMs = Date.now() - startedAt;
        const checkResult = {
          checked_at: new Date().toISOString(),
          ok: healthy,
          latency_ms: latencyMs,
        };

        const { error: updateError } = await db
          .from('platform_connections')
          .update({ last_health_check: checkResult })
          .eq('id', connection.id);
        if (updateError) {
          console.error(`[token-health-check] result write failed: ${updateError.message}`);
        }

        if (healthy === true) {
          counts.healthy += 1;
          // Proactive: token valid but expiring soon -> refresh now.
          if (needsRefresh(connection)) refreshDue.push(connection.id);
        } else if (healthy === false) {
          counts.expired += 1;
          await markConnectionExpired(connection, 'Health check got 401/403');
        } else {
          counts.unknown += 1;
        }
      }

      return { ...counts, refreshDue };
    });

    if (summary.refreshDue.length > 0) {
      await step.sendEvent(
        'send-refresh-events',
        summary.refreshDue.map((connectionId) => ({
          name: 'tokens/refresh' as const,
          data: { connectionId },
        }))
      );
    }

    return {
      checked: summary.checked,
      healthy: summary.healthy,
      expired: summary.expired,
      unknown: summary.unknown,
      refreshTriggered: summary.refreshDue.length,
    };
  }
);

export const refreshExpiringTokens = inngest.createFunction(
  {
    id: 'refresh-expiring-tokens',
    retries: 1,
  },
  { cron: '*/30 * * * *' },
  async ({ step }) => {
    const expiring = await step.run('find-expiring', async () => {
      const db = getServiceDb();
      const in1h = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const in7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Per-platform windows: X tokens live 2h (refresh when <1h left),
      // LinkedIn tokens live 60d (refresh when <7d left).
      const { data, error } = await db
        .from('platform_connections')
        .select('id, platform, token_expires_at')
        .eq('status', 'active')
        .not('token_expires_at', 'is', null)
        .or(
          `and(platform.eq.x,token_expires_at.lt.${in1h}),and(platform.eq.linkedin,token_expires_at.lt.${in7d})`
        )
        .returns<Pick<ConnectionRow, 'id' | 'platform' | 'token_expires_at'>[]>();

      if (error) throw new Error(`[refresh-expiring-tokens] query failed: ${error.message}`);
      return (data ?? []).map((row) => row.id);
    });

    if (expiring.length > 0) {
      await step.sendEvent(
        'fan-out-refresh',
        expiring.map((connectionId) => ({
          name: 'tokens/refresh' as const,
          data: { connectionId },
        }))
      );
    }

    return { found: expiring.length };
  }
);
