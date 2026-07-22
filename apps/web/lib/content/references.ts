// Pattern library access (GOAL-RUN9 §7). Global curated rows (workspace_id
// NULL) are visible to every workspace; workspace-owned rows only to theirs.
// Service role bypasses RLS, so the OR filter here IS the tenancy boundary.
import { getServiceDb, isMissingSchemaError, type ContentReferenceRow } from '@/lib/db';

const REFERENCE_COLUMNS =
  'id, workspace_id, platform, source_url, author_name, published_at, engagement, ' +
  'reference_type, hook, structure, why_it_worked, reusable_pattern, relevance_tags, ' +
  'relevance_score, verified_at, created_at';

export async function listContentReferences(workspaceId: string): Promise<ContentReferenceRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_references')
    .select(REFERENCE_COLUMNS)
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order('relevance_score', { ascending: false })
    .limit(100)
    .returns<ContentReferenceRow[]>();
  if (error) {
    // Read path degrades: without the table the angle cards fall back to the
    // lens definitions instead of crashing the Start tab.
    if (isMissingSchemaError(error.code)) {
      console.error('[patterns] content_references missing — apply migration 013:', error.message);
      return [];
    }
    throw new Error(`[patterns] reference list failed: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Honesty invariant (D2/T1.2): engagement may only be surfaced when metrics
 * exist AND were verified. Everything else renders as "unverifiziert".
 */
export function isVerifiedEngagement(reference: ContentReferenceRow): boolean {
  if (!reference.engagement || !reference.verified_at) return false;
  return Object.values(reference.engagement).some((value) => typeof value === 'number');
}
