import { NextRequest, NextResponse } from 'next/server';
import { conceptRequestSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { generateConcepts } from '@/lib/content/concept-service';

// POST /api/v1/concepts — three materially different drafts (GOAL-RUN9 §8).
// 1 credit (D7), gated in the service; publish stays a separate explicit
// user action (D4 — this route never posts anything).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = conceptRequestSchema.parse(body);
    const result = await generateConcepts(workspaceId, input);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/concepts POST', error);
  }
}
