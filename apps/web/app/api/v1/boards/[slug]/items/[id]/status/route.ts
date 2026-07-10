import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { BOARD_ITEM_STATUSES, updateBoardItemStatus } from '@/lib/board/board-service';

const statusBodySchema = z.object({
  status: z.enum(BOARD_ITEM_STATUSES),
});

// PATCH /api/v1/boards/[slug]/items/[id]/status — authenticated status change.
// The item is verified against the caller's workspace inside the service
// (Invariante 2); the slug in the path is not trusted for authorization.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const { status } = statusBodySchema.parse(body);
    const item = await updateBoardItemStatus(workspaceId, id, status);
    return NextResponse.json(item);
  } catch (error) {
    return handleRouteError('v1/boards status PATCH', error);
  }
}
