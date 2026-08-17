import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { contentGoalSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { preparePost } from '@/lib/publish/prepare';

// POST /api/v1/publish/prepare — GOAL-RUN11 One Path. Composes existing
// building blocks (concepts, connections, next slot) into one call; costs
// exactly what those blocks cost (CREDIT_COSTS.post_concepts). Never posts.
const bodySchema = z
  .object({
    topic: z.string().trim().min(3).max(4000).optional(),
    /** Angle card text from GET /v1/concepts/angles (deterministic, 0 credits). */
    angle: z.string().trim().min(3).max(500).optional(),
    content_goal: contentGoalSchema.optional(),
    output_language: z.enum(['de', 'en']).optional(),
  })
  .refine((body) => body.topic !== undefined || body.angle !== undefined, {
    message: 'Provide a topic, a suggested angle, or both.',
  });

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = bodySchema.parse(body);
    const result = await preparePost(workspaceId, input);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/publish/prepare POST', error);
  }
}
