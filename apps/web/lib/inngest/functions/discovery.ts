import { inngest } from '../client';
import {
  getServiceDb,
  type DiscoveryCommunityRow,
  type PostItemRow,
  type WorkspaceContextRow,
} from '@/lib/db';
import { communityExternalId, scanCommunity } from '@/lib/discovery/thread-radar';
import { getDiscoveryProvider, toDiscoveryProvider } from '@/lib/discovery/providers';
import type { DiscoveryProvider } from '@/lib/integrations/registry';
import type { IntegrationProvider } from '@/lib/integrations/types';

export const threadRadar = inngest.createFunction(
  {
    id: 'thread-radar',
    retries: 2,
    concurrency: [{ limit: 2, key: 'event.data.workspaceId' }],
  },
  { event: 'discovery/thread-radar' },
  async ({ event, step }) => {
    const { communityId, workspaceId } = event.data;

    const loaded = await step.run('load-community-and-context', async () => {
      const db = getServiceDb();
      const { data: community, error } = await db
        .from('discovery_communities')
        .select('*')
        .eq('id', communityId)
        .eq('workspace_id', workspaceId)
        .maybeSingle<DiscoveryCommunityRow>();
      if (error) throw new Error(`[thread-radar] community load failed: ${error.message}`);
      if (!community || !community.is_active) {
        return { community: null, context: null };
      }

      const { data: context, error: contextError } = await db
        .from('workspace_contexts')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle<WorkspaceContextRow>();
      if (contextError) {
        throw new Error(`[thread-radar] context load failed: ${contextError.message}`);
      }
      return { community, context };
    });

    if (!loaded.community) {
      return { skipped: true, reason: 'community missing or inactive' };
    }
    if (!loaded.context?.product_description) {
      // Without a product context Stage 2 cannot evaluate relevance.
      return { skipped: true, reason: 'workspace has no product context — run auto-context first' };
    }

    // Both filter stages live in one step: candidates and evaluations are
    // intermediate state, only opportunity rows are durable output.
    const result = await step.run('scan-community', async () => {
      return scanCommunity(loaded.community as DiscoveryCommunityRow, loaded.context as WorkspaceContextRow);
    });

    return {
      community: loaded.community.community_name,
      ...result,
    };
  }
);

export const scheduledThreadRadar = inngest.createFunction(
  {
    id: 'scheduled-thread-radar',
    retries: 1,
  },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const communities = await step.run('scan-active-communities', async () => {
      const db = getServiceDb();
      // Every platform, not just Reddit — `platform` became genuinely
      // multi-valued with migration 015, and scanCommunity picks the provider.
      const { data, error } = await db
        .from('discovery_communities')
        .select('id, workspace_id')
        .eq('is_active', true)
        .limit(500)
        .returns<Array<Pick<DiscoveryCommunityRow, 'id' | 'workspace_id'>>>();
      if (error) throw new Error(`[scheduled-thread-radar] query failed: ${error.message}`);
      return data ?? [];
    });

    if (communities.length > 0) {
      await step.sendEvent(
        'fan-out-radar',
        communities.map((community) => ({
          name: 'discovery/thread-radar' as const,
          data: { communityId: community.id, workspaceId: community.workspace_id },
        }))
      );
    }
    return { communities: communities.length };
  }
);

export const communityHealthCheck = inngest.createFunction(
  {
    id: 'community-health-check',
    retries: 1,
  },
  { event: 'discovery/community-health' },
  async ({ event, step }) => {
    const { workspaceId } = event.data;

    return step.run('check-communities', async () => {
      const db = getServiceDb();

      const { data: communities, error } = await db
        .from('discovery_communities')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .returns<DiscoveryCommunityRow[]>();
      if (error) throw new Error(`[community-health] query failed: ${error.message}`);

      // One provider instance per platform, built lazily: a workspace whose
      // Reddit credentials are gone must still get its Mastodon communities
      // refreshed instead of the whole check failing on the first one.
      const providers = new Map<IntegrationProvider, DiscoveryProvider | null>();
      const providerFor = async (platform: string): Promise<DiscoveryProvider | null> => {
        const id = toDiscoveryProvider(platform);
        if (!id) return null;
        if (!providers.has(id)) {
          try {
            providers.set(id, await getDiscoveryProvider(workspaceId, id));
          } catch (buildError) {
            console.error(
              `[community-health] provider ${id} unavailable:`,
              buildError instanceof Error ? buildError.message : buildError
            );
            providers.set(id, null);
          }
        }
        return providers.get(id) ?? null;
      };

      let updated = 0;
      let deactivated = 0;
      let skipped = 0;

      for (const community of communities ?? []) {
        const provider = await providerFor(community.platform);
        if (!provider) {
          skipped++;
          continue;
        }

        const externalId = communityExternalId(community);
        try {
          const info = provider.getCommunityInfo
            ? await provider.getCommunityInfo(externalId)
            : null;

          if (!info) {
            // No refreshable metadata: fall back to a liveness probe so the
            // community is only deactivated when it is genuinely unreachable.
            await provider.getHotThreads(externalId, 1);
            continue;
          }

          const active = info.activeCount ?? 0;
          const activityLevel =
            active > 1000 || info.memberCount > 500_000
              ? 'high'
              : active > 100 || info.memberCount > 50_000
                ? 'medium'
                : 'low';

          const { error: updateError } = await db
            .from('discovery_communities')
            .update({ member_count: info.memberCount, activity_level: activityLevel })
            .eq('id', community.id);
          if (updateError) {
            console.error('[community-health] update failed:', updateError.message);
          } else {
            updated++;
          }
        } catch (probeError) {
          // Banned/private/deleted community -> deactivate, stop scanning it.
          console.error(
            `[community-health] ${community.community_name} unreachable — deactivating:`,
            probeError instanceof Error ? probeError.message : probeError
          );
          const { error: deactivateError } = await db
            .from('discovery_communities')
            .update({ is_active: false })
            .eq('id', community.id);
          if (!deactivateError) deactivated++;
        }
      }

      return { checked: (communities ?? []).length, updated, deactivated, skipped };
    });
  }
);

export const scheduledCommunityHealth = inngest.createFunction(
  {
    id: 'scheduled-community-health',
    retries: 1,
  },
  { cron: '0 3 * * 0' },
  async ({ step }) => {
    // Weekly counter reset (cooldown tracking) — Sunday 03:00 UTC.
    await step.run('reset-weekly-counters', async () => {
      const db = getServiceDb();
      const { error } = await db.rpc('reset_community_weekly_counts');
      if (error) throw new Error(`[community-health] weekly reset failed: ${error.message}`);
      return { reset: true };
    });

    const workspaces = await step.run('find-workspaces', async () => {
      const db = getServiceDb();
      const { data, error } = await db
        .from('discovery_communities')
        .select('workspace_id')
        .eq('is_active', true)
        .returns<Array<{ workspace_id: string }>>();
      if (error) throw new Error(`[community-health] workspace query failed: ${error.message}`);
      return [...new Set((data ?? []).map((row) => row.workspace_id))];
    });

    if (workspaces.length > 0) {
      await step.sendEvent(
        'fan-out-health-checks',
        workspaces.map((workspaceId) => ({
          name: 'discovery/community-health' as const,
          data: { workspaceId },
        }))
      );
    }
    return { workspaces: workspaces.length };
  }
);

export const opportunityExpiry = inngest.createFunction(
  {
    id: 'opportunity-expiry',
    retries: 1,
  },
  { cron: '0 */12 * * *' },
  async ({ step }) => {
    return step.run('expire-old-opportunities', async () => {
      const db = getServiceDb();
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const { data, error } = await db
        .from('opportunity_threads')
        .update({ status: 'expired' })
        .eq('status', 'new')
        .lt('created_at', cutoff)
        .select('id');
      if (error) throw new Error(`[opportunity-expiry] update failed: ${error.message}`);
      return { expired: (data ?? []).length };
    });
  }
);

export const optimalTiming = inngest.createFunction(
  {
    id: 'optimal-timing',
    retries: 1,
  },
  { event: 'discovery/optimal-timing' },
  async ({ event, step }) => {
    const { workspaceId, platform } = event.data;

    return step.run('analyze-timing', async () => {
      const db = getServiceDb();
      const { data, error } = await db
        .from('post_items')
        .select('published_at, metrics, post_groups!inner(workspace_id)')
        .eq('post_groups.workspace_id', workspaceId)
        .eq('platform', platform)
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .limit(500)
        .returns<Array<Pick<PostItemRow, 'published_at' | 'metrics'>>>();
      if (error) throw new Error(`[optimal-timing] query failed: ${error.message}`);

      // Engagement per (weekday, hour) bucket.
      const buckets = new Map<string, { total: number; count: number }>();
      for (const item of data ?? []) {
        if (!item.published_at) continue;
        const date = new Date(item.published_at);
        const key = `${date.getUTCDay()}:${date.getUTCHours()}`;
        const metrics = item.metrics ?? {};
        const engagement =
          (typeof metrics.likes === 'number' ? metrics.likes : 0) +
          (typeof metrics.shares === 'number' ? metrics.shares : 0) * 2 +
          (typeof metrics.comments === 'number' ? metrics.comments : 0) * 3;
        const bucket = buckets.get(key) ?? { total: 0, count: 0 };
        bucket.total += engagement;
        bucket.count += 1;
        buckets.set(key, bucket);
      }

      if (buckets.size === 0) {
        return { platform, windows: [], note: 'not enough published posts with metrics yet' };
      }

      const windows = [...buckets.entries()]
        .map(([key, bucket]) => {
          const [day, hour] = key.split(':').map(Number);
          return { day_of_week: day, hour_utc: hour, avg_engagement: bucket.total / bucket.count, samples: bucket.count };
        })
        .filter((w) => w.samples >= 2)
        .sort((a, b) => b.avg_engagement - a.avg_engagement)
        .slice(0, 3);

      return { platform, windows };
    });
  }
);
