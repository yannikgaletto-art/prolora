// Product profile service (GOAL-RUN9 §6). One workspace = one product (D1);
// the profile lives in workspace_contexts, proof assets in their own table.
// Every access is workspace-scoped (Invariante 2 — service role bypasses RLS).
import type { ProductProfileResponse, ProofAsset } from '@prolora/shared';
import { getServiceDb, type ProofAssetRow, type WorkspaceContextRow } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';

const PROOF_ASSET_COLUMNS = 'id, type, content, source_url, verified_at, created_at';
const MAX_PROOF_ASSETS = 50;

function toProofAsset(row: Pick<ProofAssetRow, 'id' | 'type' | 'content' | 'source_url' | 'verified_at' | 'created_at'>): ProofAsset {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    source_url: row.source_url,
    verified_at: row.verified_at,
    created_at: row.created_at,
  };
}

export async function listProofAssets(workspaceId: string): Promise<ProofAsset[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('proof_assets')
    .select(PROOF_ASSET_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(MAX_PROOF_ASSETS)
    .returns<ProofAssetRow[]>();
  if (error) {
    throw new Error(`[product] proof asset list failed: ${error.message}`);
  }
  return (data ?? []).map(toProofAsset);
}

export async function createProofAsset(
  workspaceId: string,
  input: { type: ProofAsset['type']; content: string; source_url?: string }
): Promise<ProofAsset> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('proof_assets')
    .insert({
      workspace_id: workspaceId,
      type: input.type,
      content: input.content,
      source_url: input.source_url ?? null,
    })
    .select(PROOF_ASSET_COLUMNS)
    .single<ProofAssetRow>();
  if (error || !data) {
    throw new Error(`[product] proof asset insert failed: ${error?.message ?? 'no row'}`);
  }
  return toProofAsset(data);
}

export async function deleteProofAsset(workspaceId: string, assetId: string): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('proof_assets')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', assetId)
    .select('id');
  if (error) {
    throw new Error(`[product] proof asset delete failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/** Migration 012 may not be applied everywhere yet — normalize with fallbacks. */
export function normalizeProfileFields(context: WorkspaceContextRow | null): {
  core_value: string[];
  founder_perspective: string | null;
  brand_voice: string[];
  taboo_topics: string[];
} {
  return {
    core_value: context?.core_value ?? [],
    founder_perspective: context?.founder_perspective ?? null,
    brand_voice: context?.brand_voice ?? [],
    taboo_topics: context?.taboo_topics ?? [],
  };
}

export async function getProductProfile(workspaceId: string): Promise<ProductProfileResponse> {
  const [context, proofAssets] = await Promise.all([
    getWorkspaceContext(workspaceId),
    listProofAssets(workspaceId),
  ]);
  return {
    product_description: context?.product_description ?? null,
    target_audience: context?.target_audience ?? null,
    website_url: context?.website_url ?? null,
    voice_language: context?.voice_language ?? 'de',
    ...normalizeProfileFields(context),
    proof_assets: proofAssets,
  };
}

export async function updateProductProfile(
  workspaceId: string,
  patch: Partial<{
    product_description: string;
    target_audience: string;
    founder_perspective: string;
    core_value: string[];
    brand_voice: string[];
    taboo_topics: string[];
  }>
): Promise<void> {
  const db = getServiceDb();
  const payload = {
    workspace_id: workspaceId,
    ...patch,
    last_updated_at: new Date().toISOString(),
  };
  // workspace_contexts has UNIQUE(workspace_id) — same upsert as auto-context.
  const { error } = await db
    .from('workspace_contexts')
    .upsert(payload, { onConflict: 'workspace_id' });
  if (error) {
    throw new Error(`[product] profile upsert failed: ${error.message}`);
  }
}
