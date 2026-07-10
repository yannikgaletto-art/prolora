import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { reuseContent } from '@/lib/discovery/reuse-engine';

const reuseRequestSchema = z.object({
  original_post_id: z.string().uuid().optional(),
  original_content: z.string().min(20).max(20000),
  target_community: z.string().min(2).max(100),
  angle_shift: z.string().min(3).max(500),
});

// POST /api/v1/discover/reuse — recycle content with mandatory differentiation
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = reuseRequestSchema.parse(body);
    const result = await reuseContent(workspaceId, input);

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/discover/reuse POST', error);
  }
}
