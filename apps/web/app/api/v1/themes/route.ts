import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { clusterFeedbackThemes, listThemes } from '@/lib/feedback/themes';

// GET/POST /api/v1/themes (Plan 2 / 2A.1).
// GET  = Themen mit Momentum lesen.
// POST = einen Clustering-Lauf anstoßen (idempotent, ordnet nur neue Feedbacks zu).

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  min_momentum: z.coerce.number().min(0).max(1).optional(),
  include_archived: z.coerce.boolean().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const themes = await listThemes(workspaceId, {
      limit: query.limit,
      minMomentum: query.min_momentum,
      includeArchived: query.include_archived,
    });
    return NextResponse.json({ themes });
  } catch (error) {
    return handleRouteError('v1/themes GET', error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const result = await clusterFeedbackThemes(workspaceId);
    if (!result.ok && result.reason === 'migration_pending') {
      return jsonError(
        503,
        'Feedback-Themen sind noch nicht eingerichtet — supabase/migrations/016_feedback_themes.sql anwenden.',
        'migration_pending'
      );
    }
    return NextResponse.json({ run: result });
  } catch (error) {
    return handleRouteError('v1/themes POST', error);
  }
}
