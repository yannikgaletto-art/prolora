import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError, type PostItemRow } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import { isLegacyReconciliationRequired } from '@/lib/posts/reconciliation-state';

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
      .select('id, status, error_message')
      .eq('post_group_id', id)
      .eq('status', 'failed')
      .returns<Array<Pick<PostItemRow, 'id' | 'status' | 'error_message'>>>();
    if (itemsError) {
      throw new Error(`[retry] items lookup failed: ${itemsError.message}`);
    }
    const retryableItems = (failedItems ?? []).filter(
      (item) => !isLegacyReconciliationRequired(item)
    );
    if (retryableItems.length === 0) {
      if ((failedItems ?? []).some(isLegacyReconciliationRequired)) {
        return jsonError(
          409,
          'Confirm whether the post exists on the platform before retrying.',
          'reconciliation_required'
        );
      }
      return jsonError(409, 'No failed items to retry.', 'nothing_to_retry');
    }

    const ids = retryableItems.map((item) => item.id);
    let { error: updateError } = await db
      .from('post_items')
      .update({ status: 'queued', error_message: null, publish_retry_count: 0 })
      .in('id', ids)
      .eq('status', 'failed');
    if (updateError && isMissingSchemaError(updateError.code)) {
      // Migration 020 may be rolling out behind the app. The explicit manual
      // retry remains safe on the old schema, where no automatic counter exists.
      ({ error: updateError } = await db
        .from('post_items')
        .update({ status: 'queued', error_message: null })
        .in('id', ids)
        .eq('status', 'failed'));
    }
    if (updateError) {
      throw new Error(`[retry] status reset failed: ${updateError.message}`);
    }

    // Read-back: verify the reset actually landed (Double Assurance).
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
