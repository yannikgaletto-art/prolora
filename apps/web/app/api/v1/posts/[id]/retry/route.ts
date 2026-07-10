import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type PostItemRow } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';

// POST /api/v1/posts/:id/retry — failed items only. The ONLY allowed
// backwards status transition: failed -> queued (explicit user action,
// Invariante 3).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const db = getServiceDb();

    const { data: group, error: groupError } = await db
      .from('post_groups')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle<{ id: string }>();
    if (groupError) {
      throw new Error(`[retry] group lookup failed: ${groupError.message}`);
    }
    if (!group) {
      return jsonError(404, 'Post not found.', 'not_found');
    }

    const { data: failedItems, error: itemsError } = await db
      .from('post_items')
      .select('id')
      .eq('post_group_id', id)
      .eq('status', 'failed')
      .returns<Array<Pick<PostItemRow, 'id'>>>();
    if (itemsError) {
      throw new Error(`[retry] items lookup failed: ${itemsError.message}`);
    }
    if (!failedItems || failedItems.length === 0) {
      return jsonError(409, 'No failed items to retry.', 'nothing_to_retry');
    }

    const { error: updateError } = await db
      .from('post_items')
      .update({ status: 'queued', error_message: null })
      .eq('post_group_id', id)
      .eq('status', 'failed');
    if (updateError) {
      throw new Error(`[retry] status reset failed: ${updateError.message}`);
    }

    // Read-back: verify the reset actually landed (Double Assurance).
    const ids = failedItems.map((item) => item.id);
    const { data: verify, error: verifyError } = await db
      .from('post_items')
      .select('id, status')
      .in('id', ids)
      .returns<Array<Pick<PostItemRow, 'id' | 'status'>>>();
    if (verifyError || (verify ?? []).some((item) => item.status !== 'queued')) {
      throw new Error('[retry] status reset verification failed');
    }

    await inngest.send(
      ids.map((postItemId) => ({
        name: 'post/publish' as const,
        data: { postItemId, workspaceId },
      }))
    );

    return NextResponse.json({ post_group_id: id, retried: ids.length });
  } catch (error) {
    return handleRouteError('v1/posts/:id/retry POST', error);
  }
}
