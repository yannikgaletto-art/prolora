// AI media generation (spec: docs/superpowers/specs/2026-07-16-ai-media-generation-design.md).
// One provider (OpenAI): gpt-image-2 for images, sora-2 for exactly-8s videos.
// Hard EUR 10 / workspace / calendar month, enforced by an ATOMIC reservation
// RPC (advisory-locked) against the immutable media_budget_ledger. Prices are
// server-side config, never UI constants. Missing OPENAI_API_KEY degrades to a
// clean configuration error — uploads and publishing keep working.
import { ApiError } from '@/lib/api/http';
import { getServiceDb, type MediaGenerationRow } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import { MEDIA_BUCKET } from '@/lib/media/transform';

export const MEDIA_BUDGET_LIMIT_EUR = 10;

// Versioned price settings (spec: "Provider prices are configuration").
// Conservative EUR estimates incl. FX buffer, rounded UP (spec FX rule).
export const MEDIA_PRICES = {
  image: { model: 'gpt-image-2', estimated_eur: 0.12 },
  video: { model: 'sora-2', estimated_eur: 1.5 }, // 8s fixed
} as const;

export type MediaKind = keyof typeof MEDIA_PRICES;
export type MediaFormat = 'square' | 'portrait' | 'landscape';

/** Pure — calendar-month ledger key, e.g. '2026-07'. */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Pure — server-side estimate the UI displays verbatim. */
export function estimateEur(kind: MediaKind): number {
  return MEDIA_PRICES[kind].estimated_eur;
}

export function isMediaGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export interface MediaBudgetStatus {
  limit_eur: number;
  spent_eur: number;
  remaining_eur: number;
  month: string;
}

export async function getBudgetStatus(workspaceId: string): Promise<MediaBudgetStatus> {
  const db = getServiceDb();
  const month = monthKey(new Date());
  const { data, error } = await db
    .from('media_budget_ledger')
    .select('estimated_eur, final_eur, state')
    .eq('workspace_id', workspaceId)
    .eq('month', month)
    .in('state', ['reserved', 'committed'])
    .returns<Array<{ estimated_eur: number; final_eur: number | null; state: string }>>();
  if (error) {
    throw new Error(`[media-gen] budget query failed: ${error.message}`);
  }
  const spent = (data ?? []).reduce(
    (sum, row) => sum + Number(row.final_eur ?? row.estimated_eur),
    0
  );
  return {
    limit_eur: MEDIA_BUDGET_LIMIT_EUR,
    spent_eur: Math.round(spent * 100) / 100,
    remaining_eur: Math.max(0, Math.round((MEDIA_BUDGET_LIMIT_EUR - spent) * 100) / 100),
    month,
  };
}

export async function createGeneration(
  workspaceId: string,
  input: { kind: MediaKind; prompt: string; format: MediaFormat }
): Promise<{ generation: MediaGenerationRow; estimated_eur: number }> {
  if (!isMediaGenerationConfigured()) {
    throw new ApiError(
      503,
      'AI media generation is not configured on this server (OPENAI_API_KEY missing). Uploads still work.',
      'media_generation_not_configured'
    );
  }
  if (input.kind === 'video' && input.format === 'square') {
    throw new ApiError(400, 'Square video is not supported — use portrait or landscape.', 'invalid_format');
  }

  const db = getServiceDb();
  const price = MEDIA_PRICES[input.kind];

  // 1. Create the generation record (pending).
  const { data: generation, error: insertError } = await db
    .from('media_generations')
    .insert({
      workspace_id: workspaceId,
      kind: input.kind,
      prompt: input.prompt,
      format: input.format,
      provider: 'openai',
      model: price.model,
      status: 'pending',
    })
    .select('*')
    .single<MediaGenerationRow>();
  if (insertError || !generation) {
    throw new Error(`[media-gen] insert failed: ${insertError?.message ?? 'no row'}`);
  }

  // 2. Atomic budget reservation (RPC, advisory-locked — spec).
  const { data: reserved, error: rpcError } = await db.rpc('reserve_media_budget', {
    p_workspace: workspaceId,
    p_generation: generation.id,
    p_month: monthKey(new Date()),
    p_estimate: price.estimated_eur,
    p_limit: MEDIA_BUDGET_LIMIT_EUR,
    p_provider: 'openai',
    p_model: price.model,
  });
  if (rpcError) {
    await db.from('media_generations').delete().eq('id', generation.id);
    throw new Error(`[media-gen] reservation RPC failed: ${rpcError.message}`);
  }
  if (reserved !== true) {
    await db.from('media_generations').delete().eq('id', generation.id);
    const status = await getBudgetStatus(workspaceId);
    throw new ApiError(
      402,
      `Monthly AI media budget reached (${status.spent_eur.toFixed(2)} / ${MEDIA_BUDGET_LIMIT_EUR} EUR).`,
      'media_budget_exceeded'
    );
  }

  // 3. Hand off to the worker — the provider call never runs in the request.
  await inngest.send({
    name: 'media/generate',
    data: { generationId: generation.id, workspaceId },
  });

  return { generation, estimated_eur: price.estimated_eur };
}

export async function getGenerationWithPreview(
  workspaceId: string,
  generationId: string
): Promise<(MediaGenerationRow & { preview_url: string | null }) | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('media_generations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', generationId)
    .maybeSingle<MediaGenerationRow>();
  if (error) {
    throw new Error(`[media-gen] lookup failed: ${error.message}`);
  }
  if (!data) return null;

  let previewUrl: string | null = null;
  if (data.status === 'succeeded' && data.storage_key) {
    const { data: signed, error: signError } = await db.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(data.storage_key, 600); // short-lived (Invariante 6/R2)
    if (!signError) previewUrl = signed?.signedUrl ?? null;
  }
  return { ...data, preview_url: previewUrl };
}

// Ledger transitions used by the worker.
export async function commitReservation(generationId: string): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('media_budget_ledger')
    .update({ state: 'committed', updated_at: new Date().toISOString() })
    .eq('generation_id', generationId)
    .eq('state', 'reserved');
  if (error) console.error('[media-gen] ledger commit failed:', error.message);
}

export async function releaseReservation(generationId: string): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('media_budget_ledger')
    .update({ state: 'released', updated_at: new Date().toISOString() })
    .eq('generation_id', generationId)
    .eq('state', 'reserved');
  if (error) console.error('[media-gen] ledger release failed:', error.message);
}
