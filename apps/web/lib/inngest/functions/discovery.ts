import { inngest } from '../client';
import {
  getServiceDb,
  type DiscoveryCommunityRow,
  type PostItemRow,
  type WorkspaceContextRow,
} from '@/lib/db';
import { scanCommunity } from '@/lib/discovery/thread-radar';
import { getRedditClient } from '@/lib/discovery/reddit-client';

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
      const { data, error } = await db
        .from('discovery_communities')
        .select('id, workspace_id')
        .eq('is_active', true)
        .eq('platform', 'reddit')
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
      const reddit = getRedditClient();

      const { data: communities, error } = await db
        .from('discovery_communities')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .eq('platform', 'reddit')
        .returns<DiscoveryCommunityRow[]>();
      if (error) throw new Error(`[community-health] query failed: ${error.message}`);

      let updated = 0;
      let deactivated = 0;

      for (const community of communities ?? []) {
        const subreddit = community.community_name.replace(/^r\//, '');
        try {
          const about = await reddit.getSubredditAbout(subreddit);
          const active = about.active_user_count ?? 0;
          const activityLevel =
            active > 1000 || about.subscribers > 500_000
              ? 'high'
              : active > 100 || about.subscribers > 50_000
                ? 'medium'
                : 'low';

          const { error: updateError } = await db
            .from('discovery_communities')
            .update({ member_count: about.subscribers, activity_level: activityLevel })
            .eq('id', community.id);
          if (updateError) {
            console.error('[community-health] update failed:', updateError.message);
          } else {
            updated++;
          }
        } catch (aboutError) {
          // Banned/private/deleted subreddit -> deactivate, stop scanning it.
          console.error(
            `[community-health] r/${subreddit} unreachable — deactivating:`,
            aboutError instanceof Error ? aboutError.message : aboutError
          );
          const { error: deactivateError } = await db
            .from('discovery_communities')
            .update({ is_active: false })
            .eq('id', community.id);
          if (!deactivateError) deactivated++;
        }
      }

      return { checked: (communities ?? []).length, updated, deactivated };
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
