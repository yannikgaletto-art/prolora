import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { listWriterReviews } from '@/lib/writer/reviews';

const statusSchema = z
  .enum(['pending', 'approved', 'invalidated', 'rejected', 'expired'])
  .optional();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const status = statusSchema.parse(req.nextUrl.searchParams.get('status') ?? undefined);
    const reviews = await listWriterReviews(workspaceId, status);
    return NextResponse.json({ reviews });
  } catch (error) {
    return handleRouteError('v1/writer/reviews GET', error);
  }
}
