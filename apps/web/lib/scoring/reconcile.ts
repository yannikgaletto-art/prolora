// GOAL-RUN8 T2.4: reconciliation is idempotent, connection-local and never
// lets immature or stub-platform metrics distort calibration.
import type { PlatformType } from '@prolora/shared';
import { getServiceDb, type ImpactPredictionRow } from '@/lib/db';
import {
  CALIBRATABLE_PLATFORMS,
  classifyOutcome,
  computeBaseline,
  engagementScore,
  type Baseline,
} from '@/lib/scoring/baseline';

const RECONCILIATION_AGE_MS = 48 * 60 * 60 * 1000;
const MATURE_METRICS_AGE_MS = 40 * 60 * 60 * 1000;
const BASELINE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const BASELINE_LIMIT = 100;

interface MetricHistoryRow {
  metrics: Record<string, unknown>;
  published_at: string | null;
  metrics_updated_at: string | null;
}

export function hasReachedReconciliationAge(publishedAt: string, now = new Date()): boolean {
  const published = new Date(publishedAt).getTime();
  return Number.isFinite(published) && published + RECONCILIATION_AGE_MS <= now.getTime();
}

export function matureHistoryEngagement(rows: MetricHistoryRow[]): number[] {
  return rows.flatMap((row) => {
    if (!row.published_at || !row.metrics_updated_at) return [];
    const published = new Date(row.published_at).getTime();
    const updated = new Date(row.metrics_updated_at).getTime();
    if (!Number.isFinite(published) || !Number.isFinite(updated)) return [];
    if (updated < published + MATURE_METRICS_AGE_MS) return [];
    return [engagementScore(toMetrics(row.metrics))];
  });
}

export async function loadConnectionBaseline(input: {
  workspaceId: string;
  connectionId: string;
  platform: PlatformType;
  now?: Date;
  excludePostItemId?: string;
}): Promise<Baseline> {
  if (!isCalibratablePlatform(input.platform)) return computeBaseline([]);
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - BASELINE_WINDOW_MS).toISOString();
  const db = getServiceDb();
  let query = db
    .from('post_items')
    .select('metrics, published_at, metrics_updated_at, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', input.workspaceId)
    .eq('connection_id', input.connectionId)
    .eq('platform', input.platform)
    .eq('status', 'published')
    .gte('published_at', cutoff)
    .order('published_at', { ascending: false })
    .limit(BASELINE_LIMIT);
  if (input.excludePostItemId) query = query.neq('id', input.excludePostItemId);
  const { data, error } = await query.returns<
    Array<MetricHistoryRow & { post_groups: { workspace_id: string } }>
  >();
  if (error) throw new Error(`[impact] baseline lookup failed: ${error.message}`);
  return computeBaseline(matureHistoryEngagement(data ?? []));
}

export async function reconcileImpact(input: {
  workspaceId: string;
  postItemId: string;
  now?: Date;
}): Promise<{ reconciled: boolean; reason?: string; baselineN?: number }> {
  const now = input.now ?? new Date();
  const db = getServiceDb();
  const { data: item, error: itemError } = await db
    .from('post_items')
    .select('id, connection_id, platform, published_at, metrics, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', input.workspaceId)
    .eq('id', input.postItemId)
    .maybeSingle<{
      id: string;
      connection_id: string;
      platform: PlatformType;
      published_at: string | null;
      metrics: Record<string, unknown>;
      post_groups: { workspace_id: string };
    }>();
  if (itemError) throw new Error(`[impact] item lookup failed: ${itemError.message}`);
  if (!item?.published_at) return { reconciled: false, reason: 'item is not published' };
  if (!hasReachedReconciliationAge(item.published_at, now)) {
    return { reconciled: false, reason: 'metrics are not 48h old' };
  }

  const { data: prediction, error: predictionError } = await db
    .from('impact_predictions')
    .select('id, outcome_at')
    .eq('workspace_id', input.workspaceId)
    .eq('post_item_id', item.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Pick<ImpactPredictionRow, 'id' | 'outcome_at'>>();
  if (predictionError) {
    throw new Error(`[impact] prediction lookup failed: ${predictionError.message}`);
  }
  if (!prediction) return { reconciled: false, reason: 'no matching prediction' };
  if (prediction.outcome_at) return { reconciled: false, reason: 'already reconciled' };

  const engagement = engagementScore(toMetrics(item.metrics));
  const baseline = await loadConnectionBaseline({
    workspaceId: input.workspaceId,
    connectionId: item.connection_id,
    platform: item.platform,
    now,
    excludePostItemId: item.id,
  });
  const classified = classifyOutcome(engagement, baseline);
  const { error: updateError } = await db
    .from('impact_predictions')
    .update({
      outcome_engagement: engagement,
      outcome_ratio: classified.ratio,
      outcome_z: classified.z,
      outcome_bucket: classified.bucket,
      baseline_n: baseline.n,
      outcome_at: now.toISOString(),
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', prediction.id)
    .is('outcome_at', null);
  if (updateError) throw new Error(`[impact] outcome update failed: ${updateError.message}`);
  return { reconciled: true, baselineN: baseline.n };
}

function isCalibratablePlatform(platform: PlatformType): boolean {
  return (CALIBRATABLE_PLATFORMS as readonly string[]).includes(platform);
}

function toMetrics(metrics: Record<string, unknown>): {
  likes?: number;
  comments?: number;
  shares?: number;
} {
  return {
    likes: numberMetric(metrics.likes),
    comments: numberMetric(metrics.comments),
    shares: numberMetric(metrics.shares),
  };
}

function numberMetric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
