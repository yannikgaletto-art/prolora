import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { getServiceDb } from '@/lib/db';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { inngest } from '@/lib/inngest/client';

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

// POST /api/v1/posts/items/:id/reconcile — explicit operator resolution for
// an ambiguous external publish. This endpoint never calls a platform adapter.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
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
    if (error) {
      throw new Error(`[post reconciliation] resolution failed: ${error.message}`);
    }

    const rows = (Array.isArray(data) ? data : data ? [data] : []) as ReconciledPostItem[];
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
        name: 'post/publish',
        data: { postItemId: id, workspaceId },
      });
    }

    return NextResponse.json(reconciled);
  } catch (error) {
    return handleRouteError('v1/posts/items/:id/reconcile POST', error);
  }
}
