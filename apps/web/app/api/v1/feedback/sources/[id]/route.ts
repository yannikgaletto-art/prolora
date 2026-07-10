import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';

const idSchema = z.string().uuid();

// DELETE /api/v1/feedback/sources/[id] — soft-deactivate only. Historical
// raw_feedback keeps its source_id, so sources are never hard-deleted.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      return jsonError(404, 'Feedback source not found.', 'source_not_found');
    }

    const db = getServiceDb();
    const { data, error } = await db
      .from('feedback_sources')
      .update({ status: 'inactive' })
      .eq('id', parsedId.data)
      .eq('workspace_id', workspaceId)
      .select('id, status')
      .maybeSingle<{ id: string; status: string }>();
    if (error) {
      console.error('[v1/feedback/sources DELETE] update failed:', error.message);
      return jsonError(500, 'Could not deactivate the feedback source.', 'update_failed');
    }
    if (!data) {
      return jsonError(404, 'Feedback source not found.', 'source_not_found');
    }

    return NextResponse.json({ id: data.id, status: data.status });
  } catch (error) {
    return handleRouteError('v1/feedback/sources DELETE', error);
  }
}
