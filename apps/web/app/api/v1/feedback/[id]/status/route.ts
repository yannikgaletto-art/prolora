import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type FeedbackItemRow } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';

type FeedbackStatus = FeedbackItemRow['status'];

// Schema reality: feedback_items.status CHECK allows only these four values
// (no planned/in_progress/shipped). 'actioned' is the shipped-analog that
// triggers the board closed-loop below.
const ALLOWED_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  new: ['reviewed'],
  reviewed: ['actioned'],
  actioned: ['archived', 'reviewed'], // archived = forward, reviewed = correction path
  archived: [],
};

const bodySchema = z.object({
  status: z.enum(['new', 'reviewed', 'actioned', 'archived']),
});

// PATCH /api/v1/feedback/[id]/status — AUTH, guarded status transition.
// Transition to 'actioned' closes the loop: linked board items are marked
// shipped and their voters get notified via Inngest.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'Invalid feedback id.', 'invalid_id');
    }

    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const { status: newStatus } = bodySchema.parse(body);

    const db = getServiceDb();
    const { data: item, error: loadError } = await db
      .from('feedback_items')
      .select('id, status')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .maybeSingle<{ id: string; status: FeedbackStatus }>();
    if (loadError) {
      console.error('[feedback] status load failed:', loadError.message);
      return jsonError(500, 'Could not load feedback item.', 'query_failed');
    }
    if (!item) {
      return jsonError(404, 'Feedback item not found.', 'not_found');
    }

    const allowedNext = ALLOWED_TRANSITIONS[item.status] ?? [];
    if (!allowedNext.includes(newStatus)) {
      return jsonError(
        400,
        `Invalid status transition '${item.status}' -> '${newStatus}'. Allowed next states: ${
          allowedNext.length > 0 ? allowedNext.join(', ') : 'none'
        }.`,
        'invalid_transition'
      );
    }

    const { data: updated, error: updateError } = await db
      .from('feedback_items')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .single<FeedbackItemRow>();
    if (updateError || !updated) {
      console.error('[feedback] status update failed:', updateError?.message ?? 'no row');
      return jsonError(500, 'Could not update feedback status.', 'update_failed');
    }

    console.log(`[feedback] status ${id}: ${item.status} -> ${newStatus}`);

    // Closed-loop: 'actioned' ships every linked board item. Best-effort —
    // failures are logged and never roll back the status change (Invariante 4).
    let shippedBoardItemIds: string[] = [];
    if (newStatus === 'actioned') {
      shippedBoardItemIds = await shipLinkedBoardItems(workspaceId, id);
    }

    return NextResponse.json({
      feedback: updated,
      ...(newStatus === 'actioned' ? { shipped_board_items: shippedBoardItemIds } : {}),
    });
  } catch (error) {
    return handleRouteError('v1/feedback/status PATCH', error);
  }
}

async function shipLinkedBoardItems(
  workspaceId: string,
  feedbackId: string
): Promise<string[]> {
  const db = getServiceDb();
  const shipped: string[] = [];

  const { data: boardItems, error: boardError } = await db
    .from('board_items')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .contains('linked_feedback_ids', [feedbackId])
    .returns<{ id: string; status: string }[]>();
  if (boardError) {
    console.error('[board] closed-loop board item lookup failed:', boardError.message);
    return shipped;
  }

  for (const boardItem of boardItems ?? []) {
    if (boardItem.status === 'shipped') continue;

    const { error: shipError } = await db
      .from('board_items')
      .update({ status: 'shipped', shipped_at: new Date().toISOString() })
      .eq('id', boardItem.id)
      .eq('workspace_id', workspaceId)
      .neq('status', 'shipped');
    if (shipError) {
      console.error(`[board] shipping item ${boardItem.id} failed:`, shipError.message);
      continue;
    }

    shipped.push(boardItem.id);
    console.log(`[board] item ${boardItem.id} shipped via feedback closed-loop`);
  }

  if (shipped.length > 0) {
    try {
      await inngest.send(
        shipped.map((boardItemId) => ({
          name: 'board/notify-voters' as const,
          data: { boardItemId, newStatus: 'shipped' },
        }))
      );
    } catch (error) {
      console.error(
        '[board] notify-voters event send failed:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return shipped;
}
