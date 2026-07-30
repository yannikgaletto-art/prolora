import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';
import { requestWriterReviewChange } from '@/lib/writer/reviews';

const idSchema = z.string().uuid();
const changeSchema = z.object({
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().trim().min(1).max(20_000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    await requireWriterOwnerOrAdmin(auth);
    const parsedId = idSchema.safeParse((await params).id);
    if (!parsedId.success) {
      return jsonError(400, 'Invalid Writer review ID.', 'invalid_request');
    }
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = changeSchema.parse(body);
    const review = await requestWriterReviewChange(
      auth.workspaceId,
      parsedId.data,
      input.snapshot_hash,
      input.reason
    );
    return NextResponse.json({ review });
  } catch (error) {
    return handleRouteError('v1/writer/reviews/:id/request-change POST', error);
  }
}
