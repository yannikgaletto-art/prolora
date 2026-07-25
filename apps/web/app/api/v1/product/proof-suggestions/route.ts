import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { listProofSuggestions, scanFeedbackForProofs } from '@/lib/feedback/proof-extraction';

// GET/POST /api/v1/product/proof-suggestions (Plan 2 / 2A.3).
//
// Lag während des Parallel-Laufs unter /themes, weil Plan 2 §3 dem bauenden
// Agenten nur die Namensräume themes und visuals zuwies. In I2 hierher
// verschoben — ein Proof-Vorschlag gehört neben /product/proof-assets, wo das
// bestätigte Asset entsteht.
//
// Harte Regel dieser Route: POST SCANNT nur und legt PENDING-Vorschläge an.
// Ein proof_asset entsteht ausschließlich über den expliziten Accept-Aufruf in
// [id]/route.ts.

const querySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const scanSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const suggestions = await listProofSuggestions(workspaceId, {
      status: query.status ?? 'pending',
      limit: query.limit,
    });
    return NextResponse.json({ proof_suggestions: suggestions });
  } catch (error) {
    return handleRouteError('v1/product/proof-suggestions GET', error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => ({}));
    const input = scanSchema.parse(body ?? {});
    const result = await scanFeedbackForProofs(workspaceId, { limit: input.limit });
    if (!result.ok && result.reason === 'migration_pending') {
      return jsonError(
        503,
        'Proof-Vorschläge sind noch nicht eingerichtet — supabase/migrations/016_feedback_themes.sql anwenden.',
        'migration_pending'
      );
    }
    return NextResponse.json({ scan: result });
  } catch (error) {
    return handleRouteError('v1/product/proof-suggestions POST', error);
  }
}
