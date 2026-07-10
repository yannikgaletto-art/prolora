import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleRouteError } from '@/lib/api/http';
import { requestFingerprint, voteBoardItem } from '@/lib/board/board-service';

const voteBodySchema = z.object({
  email: z.string().email().optional(),
});

// POST /api/v1/boards/[slug]/items/[id]/vote — public, one vote per fingerprint
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
): Promise<NextResponse> {
  try {
    const { slug, id } = await params;
    // Body is optional — an empty or missing body is a valid anonymous vote.
    const body: unknown = await req.json().catch(() => ({}));
    const input = voteBodySchema.parse(body ?? {});

    const result = await voteBoardItem(slug, id, requestFingerprint(req), input.email);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/boards vote POST', error);
  }
}
