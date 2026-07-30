import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { approveWriterReview } from '@/lib/writer/materialize';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';

const idSchema = z.string().uuid();
const approvalSchema = z.object({
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  selected_channel_ids: z.array(z.string().uuid()).min(1).max(20).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const { role, userId } = await requireWriterOwnerOrAdmin(auth);
    const parsedId = idSchema.safeParse((await params).id);
    if (!parsedId.success) {
      return jsonError(400, 'Invalid Writer review ID.', 'invalid_request');
    }
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = approvalSchema.parse(body);
    const result = await approveWriterReview(
      auth.workspaceId,
      parsedId.data,
      userId,
      role,
      input.snapshot_hash,
      input.selected_channel_ids
    );
    return NextResponse.json({
      post_group_id: result.postGroupId,
      created: result.created,
    });
  } catch (error) {
    return handleRouteError('v1/writer/reviews/:id/approve POST', error);
  }
}
