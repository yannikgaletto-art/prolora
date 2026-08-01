import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type PostGroupRow, type PostItemRow } from '@/lib/db';
import { validateScheduledAt } from '@/lib/validation/pipeline';
import { assertPostQuota } from '@/lib/posts/create-post';
import { inngest } from '@/lib/inngest/client';
import { assertAiPostQaFreshForWorkspace } from '@/lib/pipeline/ai-post-qa';

// PATCH /api/v1/posts/:id/schedule — the calendar's reschedule/convert action
// (GOAL-RUN6 Phase 2). Two modes:
//   { scheduled_at, scheduled_tz? }  -> (re)schedule; drafts become 'scheduled'
//   { publish_now: true }            -> flip draft/scheduled to 'queued' + fire events
// Status-guarded UPDATE + read-back: never touches an item the sweep already
// claimed ('publishing') or one that is 'published'/'deleted'.

const bodySchema = z
  .object({
    scheduled_at: z.string().datetime().optional(),
    scheduled_tz: z.string().min(1).max(64).optional(),
    publish_now: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.scheduled_at) !== Boolean(b.publish_now), {
    message: 'Provide either scheduled_at or publish_now: true',
  });

type PostGroupWithItems = PostGroupRow & { post_items: PostItemRow[] };

const MUTABLE_STATUSES: PostItemRow['status'][] = ['draft', 'queued', 'scheduled', 'failed'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const body = bodySchema.parse(await req.json());

    const db = getServiceDb();
    const { data: group, error } = await db
      .from('post_groups')
      .select('*, post_items(*)')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle<PostGroupWithItems>();
    if (error) {
      throw new Error(`[v1/posts/:id/schedule] lookup failed: ${error.message}`);
    }
    if (!group) {
      return jsonError(404, 'Post not found.', 'not_found');
    }

    const items = group.post_items ?? [];
    if (items.some((item) => item.status === 'publishing')) {
      return jsonError(409, 'This post is publishing right now — try again in a moment.', 'publishing');
    }
    const mutable = items.filter((item) => MUTABLE_STATUSES.includes(item.status));
    if (mutable.length === 0) {
      return jsonError(
        409,
        'Nothing left to reschedule — all items are published or deleted.',
        'immutable'
      );
    }
    for (const item of mutable) {
      await assertAiPostQaFreshForWorkspace({
        workspaceId,
        platform: item.platform,
        resolvedContent: item.resolved_content ?? item.adapted_content ?? group.original_content,
        qaContext: item.qa_context,
      });
    }

    // Converting drafts into publishable items is the quota-relevant moment
    // (draft creation was exempt in createPost).
    const draftCount = mutable.filter((item) => item.status === 'draft').length;
    if (draftCount > 0) {
      await assertPostQuota(workspaceId, 0);
    }

    if (body.publish_now) {
      const { error: flipError } = await db
        .from('post_items')
        .update({ status: 'queued' })
        .eq('post_group_id', id)
        .in('status', MUTABLE_STATUSES);
      if (flipError) {
        throw new Error(`[v1/posts/:id/schedule] publish_now flip failed: ${flipError.message}`);
      }
      const { error: groupError } = await db
        .from('post_groups')
        .update({ scheduled_at: null })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      if (groupError) {
        throw new Error(`[v1/posts/:id/schedule] group update failed: ${groupError.message}`);
      }

      // Read-back, then fan out (same event the composer path uses).
      const queued = await readBack(id, 'queued', mutable.length);
      await inngest.send(
        queued.map((item) => ({
          name: 'post/publish' as const,
          data: { postItemId: item.id, workspaceId },
        }))
      );
      return NextResponse.json({ post_group_id: id, status: 'queued', items: queued.length });
    }

    // (Re)schedule mode.
    const scheduleErrors = validateScheduledAt(body.scheduled_at);
    if (scheduleErrors.length > 0) {
      throw new ApiError(400, scheduleErrors.join('; '), 'invalid_schedule');
    }

    const { error: groupError } = await db
      .from('post_groups')
      .update({
        scheduled_at: body.scheduled_at,
        ...(body.scheduled_tz ? { scheduled_tz: body.scheduled_tz } : {}),
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId);
    if (groupError) {
      throw new Error(`[v1/posts/:id/schedule] group update failed: ${groupError.message}`);
    }

    const { error: flipError } = await db
      .from('post_items')
      .update({ status: 'scheduled', error_message: null })
      .eq('post_group_id', id)
      .in('status', MUTABLE_STATUSES);
    if (flipError) {
      throw new Error(`[v1/posts/:id/schedule] status flip failed: ${flipError.message}`);
    }

    const scheduled = await readBack(id, 'scheduled', mutable.length);
    // No Inngest interaction: the publish-scheduled cron re-reads the row and
    // honors the new time — reschedule needs zero cancellation machinery.
    return NextResponse.json({
      post_group_id: id,
      status: 'scheduled',
      scheduled_at: body.scheduled_at,
      items: scheduled.length,
    });
  } catch (error) {
    return handleRouteError('v1/posts/:id/schedule PATCH', error);
  }
}

async function readBack(
  postGroupId: string,
  expected: PostItemRow['status'],
  minCount: number
): Promise<Array<Pick<PostItemRow, 'id' | 'status'>>> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_items')
    .select('id, status')
    .eq('post_group_id', postGroupId)
    .eq('status', expected)
    .returns<Array<Pick<PostItemRow, 'id' | 'status'>>>();
  if (error || (data ?? []).length < minCount) {
    throw new Error(
      `[v1/posts/:id/schedule] verification failed: expected ≥${minCount} '${expected}' items, got ${data?.length ?? 0}`
    );
  }
  return data ?? [];
}
