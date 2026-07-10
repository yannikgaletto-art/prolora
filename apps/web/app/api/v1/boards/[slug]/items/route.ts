import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleRouteError, jsonError } from '@/lib/api/http';
import {
  getPublicBoardItems,
  requestFingerprint,
  submitBoardItem,
  submitBoardItemSchema,
} from '@/lib/board/board-service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

// GET /api/v1/boards/[slug]/items — public, paginated board items
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await getPublicBoardItems(slug, query.page);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/boards items GET', error);
  }
}

// POST /api/v1/boards/[slug]/items — public submission (DB-side rate-limited)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = submitBoardItemSchema.parse(body);
    const item = await submitBoardItem(slug, input, requestFingerprint(req));
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/boards items POST', error);
  }
}
