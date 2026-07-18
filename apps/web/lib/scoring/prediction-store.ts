// GOAL-RUN8 T2.2: prediction writes are workspace-scoped and stay separate
// from model normalization so persistence can evolve without prompt drift.
import type { PlatformType } from '@prolora/shared';
import { getServiceDb } from '@/lib/db';
import type { ImpactFramework, ImpactScoreResult } from '@/lib/scoring/score-service';

export async function persistImpactPrediction(input: {
  workspaceId: string;
  platform: PlatformType;
  contentHash: string;
  result: ImpactScoreResult;
  framework: ImpactFramework;
  promptVersion: number;
  deterministicVersion: number;
  model: string;
}): Promise<string> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('impact_predictions')
    .insert({
      workspace_id: input.workspaceId,
      post_group_id: null,
      post_item_id: null,
      platform: input.platform,
      content_hash: input.contentHash,
      virality_score: input.result.virality_score,
      traffic_light: input.result.traffic_light,
      score_breakdown: input.result.score_breakdown,
      improvements: input.result.improvements,
      detected_framework: input.framework,
      prompt_version: input.promptVersion,
      deterministic_version: input.deterministicVersion,
      model: input.model,
    })
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .single<{ id: string }>();
  if (error || !data) {
    throw new Error(`[impact] prediction insert failed: ${error?.message ?? 'no row returned'}`);
  }
  return data.id;
}

export async function linkLatestPrediction(input: {
  workspaceId: string;
  platform: PlatformType;
  contentHash: string;
  postGroupId: string;
  postItemId: string;
}): Promise<boolean> {
  const db = getServiceDb();
  const { data: prediction, error: lookupError } = await db
    .from('impact_predictions')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('platform', input.platform)
    .eq('content_hash', input.contentHash)
    .is('post_item_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (lookupError) {
    throw new Error(`[impact] prediction match failed: ${lookupError.message}`);
  }
  if (!prediction) return false;

  const { error: updateError } = await db
    .from('impact_predictions')
    .update({ post_group_id: input.postGroupId, post_item_id: input.postItemId })
    .eq('workspace_id', input.workspaceId)
    .eq('id', prediction.id)
    .is('post_item_id', null);
  if (updateError) {
    throw new Error(`[impact] prediction link failed: ${updateError.message}`);
  }
  return true;
}
