import type { AutoContextResponse } from '@prolora/shared';
import { CREDIT_COSTS } from '@prolora/shared';
import { getServiceDb, type WorkspaceContextRow } from '@/lib/db';
import { extractWebsiteContext } from '@/lib/ai/extract-website-context';

// POST /discover/auto-context: website -> product context -> stored as the
// workspace's discovery baseline (workspace_contexts, one row per workspace).
export async function runAutoContext(
  workspaceId: string,
  websiteUrl: string
): Promise<AutoContextResponse & { warning?: string }> {
  const context = await extractWebsiteContext(websiteUrl);
  const db = getServiceDb();

  const payload = {
    workspace_id: workspaceId,
    website_url: websiteUrl,
    product_description: context.product_description,
    target_audience: context.target_audience,
    suggested_keywords: context.suggested_keywords,
    voice_tone: context.voice_tone,
    voice_language: context.voice_language,
    confidence: context.confidence,
    last_updated_at: new Date().toISOString(),
  };

  // workspace_contexts has UNIQUE(workspace_id) -> upsert on that key.
  const { error } = await db
    .from('workspace_contexts')
    .upsert(payload, { onConflict: 'workspace_id' });
  if (error) {
    throw new Error(`[auto-context] upsert failed: ${error.message}`);
  }

  // Read-back verify (Double Assurance).
  const { data: verify, error: verifyError } = await db
    .from('workspace_contexts')
    .select('product_description')
    .eq('workspace_id', workspaceId)
    .single<{ product_description: string | null }>();
  if (verifyError || verify?.product_description !== context.product_description) {
    throw new Error('[auto-context] write verification failed');
  }

  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'auto_context',
    credits_used: CREDIT_COSTS.auto_context,
    metadata: {
      website_url: websiteUrl,
      confidence: context.confidence,
      input_tokens: context.inputTokens,
      output_tokens: context.outputTokens,
    },
  });
  if (usageError) {
    console.error('[auto-context] usage log failed:', usageError.message);
  }

  return {
    product_description: context.product_description,
    target_audience: context.target_audience,
    suggested_keywords: context.suggested_keywords,
    suggested_voice: {
      tone: context.voice_tone,
      language: context.voice_language,
      example_phrases: context.example_phrases,
    },
    confidence: context.confidence,
    ...(context.confidence < 0.5
      ? { warning: 'Niedrige Konfidenz — bitte den extrahierten Kontext manuell prüfen.' }
      : {}),
  };
}

export async function getWorkspaceContext(workspaceId: string): Promise<WorkspaceContextRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspace_contexts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle<WorkspaceContextRow>();
  if (error) {
    throw new Error(`[auto-context] context lookup failed: ${error.message}`);
  }
  return data;
}
