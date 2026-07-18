import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scorePostSchema } from '@prolora/shared';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { runDeterministicChecks } from '@/lib/scoring/deterministic';
import { scorePost } from '@/lib/scoring/score-service';

const scoreQuerySchema = z.object({
  mode: z.enum(['checks']).optional(),
});

// GOAL-RUN8 T1.4: checks are deterministic and free; the full coach is an
// explicit, quota-gated LLM action and never blocks publishing.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const query = scoreQuerySchema.parse({
      mode: req.nextUrl.searchParams.get('mode') ?? undefined,
    });
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = scorePostSchema.parse(body);
    const deterministic = runDeterministicChecks(input.content, input.platform, {
      firstComment: input.first_comment,
    });

    if (query.mode === 'checks') {
      return NextResponse.json(deterministic);
    }

    const result = await scorePost(auth.workspaceId, {
      content: input.content,
      platform: input.platform,
      firstComment: input.first_comment,
      language: input.language,
      connectionId: input.connection_id,
      deterministic,
    });
    console.info(`[impact] scored ${input.platform}: ${result.virality_score}/100 (${result.traffic_light})`);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('impact', error);
  }
}
