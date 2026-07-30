import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getWriterReview } from '@/lib/writer/reviews';

const idSchema = z.string().uuid();

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const parsedId = idSchema.safeParse((await params).id);
    if (!parsedId.success) {
      return jsonError(400, 'Invalid Writer review ID.', 'invalid_request');
    }
    return NextResponse.json({
      review: await getWriterReview(workspaceId, parsedId.data),
    });
  } catch (error) {
    return handleRouteError('v1/writer/reviews/:id GET', error);
  }
}
