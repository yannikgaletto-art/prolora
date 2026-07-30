import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { getServiceDb } from '@/lib/db';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import { inngest } from '@/lib/inngest/client';
import {
  LEGACY_RECONCILIATION_PREFIX,
  isLegacyReconciliationRequired,
  isLegacyRepublishPending,
  legacyRepublishPendingMessage,
} from '@/lib/posts/reconciliation-state';

const reconciliationSchema = z
  .object({
    resolution: z.enum(['not_published', 'published']),
    platform_post_id: z.string().trim().min(1).max(500).optional(),
    platform_url: z.string().url().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.resolution === 'published' && !value.platform_post_id) {
      context.addIssue({
        code: 'custom',
        path: ['platform_post_id'],
        message: 'is required when the post was published',
      });
    }
  });

interface ReconciledPostItem {
  post_item_id: string;
  status: 'queued' | 'published';
  platform_post_id: string | null;
}

function isMissingReconciliationRpc(error: { code?: string | null; message?: string | null }): boolean {
  const message = error.message ?? '';
  return (
    message.includes('resolve_post_item_reconciliation') &&
    ((error.code === '42883' && /does not exist/i.test(message)) ||
      (error.code === 'PGRST202' && /could not find/i.test(message)))
  );
}

async function resolveLegacyReconciliation(input: {
  workspaceId: string;
  postItemId: string;
  resolution: 'not_published' | 'published';
  platformPostId: string | null;
  platformUrl: string | null;
}): Promise<ReconciledPostItem | null> {
  const db = getServiceDb();
  const { data: current, error: loadError } = await db
    .from('post_items')
    .select('id, status, error_message, platform_post_id, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', input.workspaceId)
    .eq('id', input.postItemId)
    .maybeSingle<{
      id: string;
      status: string;
      error_message: string | null;
      platform_post_id: string | null;
    }>();
  if (loadError) throw new Error(`[post reconciliation] legacy lookup failed: ${loadError.message}`);

  // A repeated confirmed-published request after a lost HTTP response is safe.
  if (
    current &&
    input.resolution === 'not_published' &&
    isLegacyRepublishPending(current)
  ) {
    return {
      post_item_id: current.id,
      status: 'queued',
      platform_post_id: null,
    };
  }
  if (
    current?.status === 'published' &&
    input.resolution === 'published' &&
    current.platform_post_id === input.platformPostId
  ) {
    return {
      post_item_id: current.id,
      status: 'published',
      platform_post_id: current.platform_post_id,
    };
  }
  if (!current || !isLegacyReconciliationRequired(current)) return null;

  const published = input.resolution === 'published';
  const { data: updated, error: updateError } = await db
    .from('post_items')
    .update({
      status: published ? 'published' : 'queued',
      platform_post_id: published ? input.platformPostId : null,
      platform_url: published ? input.platformUrl : null,
      published_at: published ? new Date().toISOString() : null,
      error_message: published ? null : legacyRepublishPendingMessage(),
    })
    .eq('id', input.postItemId)
    .eq('status', 'failed')
    .like('error_message', `${LEGACY_RECONCILIATION_PREFIX}%`)
    .select('id, status, platform_post_id')
    .maybeSingle<{ id: string; status: 'queued' | 'published'; platform_post_id: string | null }>();
  if (updateError) {
    throw new Error(`[post reconciliation] legacy resolution failed: ${updateError.message}`);
  }
  return updated
    ? {
        post_item_id: updated.id,
        status: updated.status,
        platform_post_id: updated.platform_post_id,
      }
    : null;
}

// POST /api/v1/posts/items/:id/reconcile — explicit operator resolution for
// an ambiguous external publish. This endpoint never calls a platform adapter.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    if (auth.method !== 'session' || auth.workspaceRole !== 'admin') {
      throw new ApiError(
        403,
        'Only workspace owners and admins can resolve publish reconciliation.',
        'forbidden'
      );
    }
    const workspaceId = auth.workspaceId;
    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    const input = reconciliationSchema.parse(body);
    const db = getServiceDb();

    const { data, error } = await db.rpc('resolve_post_item_reconciliation', {
      p_workspace_id: workspaceId,
      p_post_item_id: id,
      p_resolution: input.resolution,
      p_platform_post_id: input.platform_post_id ?? null,
      p_platform_url: input.platform_url ?? null,
    });
    if (error && !isMissingReconciliationRpc(error)) {
      throw new Error(`[post reconciliation] resolution failed: ${error.message}`);
    }

    const legacy = error
      ? await resolveLegacyReconciliation({
          workspaceId,
          postItemId: id,
          resolution: input.resolution,
          platformPostId: input.platform_post_id ?? null,
          platformUrl: input.platform_url ?? null,
        })
      : null;
    const rows = error
      ? legacy
        ? [legacy]
        : []
      : ((Array.isArray(data) ? data : data ? [data] : []) as ReconciledPostItem[]);
    if (rows.length !== 1) {
      return jsonError(
        409,
        'Post item is not awaiting this reconciliation.',
        'reconciliation_not_pending'
      );
    }
    const reconciled = rows[0];

    if (input.resolution === 'not_published') {
      // The RPC is idempotent while this delivery is pending, so a transient
      // enqueue failure can be recovered by repeating the operator action.
      await inngest.send({
        id: `post-reconciliation-republish:${id}`,
        name: 'post/publish',
        data: { postItemId: id, workspaceId },
      });
    } else {
      await inngest.send({
        id: `post-published-effects:${id}`,
        name: 'post/published-effects',
        data: { postItemId: id, workspaceId },
      });
    }

    return NextResponse.json(reconciled);
  } catch (error) {
    return handleRouteError('v1/posts/items/:id/reconcile POST', error);
  }
}
