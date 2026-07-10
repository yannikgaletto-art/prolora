import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CREDIT_COSTS } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { askFeedback } from '@/lib/ai/ask-feedback';
import { assertCreditQuota } from '@/lib/usage/credits';

const askBodySchema = z.object({
  question: z.string().min(3).max(500),
});

// POST /api/v1/feedback/ask — natural-language question over the workspace's
// feedback. Costs CREDIT_COSTS.ask_query credits; quota is checked BEFORE the
// LLM call (shared gate in lib/usage/credits.ts) and only charged after a
// successful (confidence > 0) answer.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const { question } = askBodySchema.parse(body);

    await assertCreditQuota(workspaceId, CREDIT_COSTS.ask_query);

    const result = await askFeedback(workspaceId, question);

    // confidence 0 means no data or a failed LLM call — no credits charged.
    const charged = result.confidence > 0;
    if (charged) {
      const db = getServiceDb();
      const { error } = await db.from('usage_logs').insert({
        workspace_id: workspaceId,
        action: 'ask_query',
        credits_used: CREDIT_COSTS.ask_query,
        metadata: {
          question: question.slice(0, 200),
          based_on_count: result.based_on_count,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
        },
      });
      if (error) {
        console.error('[feedback/ask] usage log failed:', error.message);
      }
    }

    return NextResponse.json({
      answer: result.answer,
      confidence: result.confidence,
      based_on_count: result.based_on_count,
      key_quotes: result.key_quotes,
      credits_used: charged ? CREDIT_COSTS.ask_query : 0,
    });
  } catch (error) {
    return handleRouteError('v1/feedback/ask POST', error);
  }
}
