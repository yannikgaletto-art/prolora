import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CREDIT_COSTS, PLAN_LIMITS, type PlanType } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { askFeedback } from '@/lib/ai/ask-feedback';

const askBodySchema = z.object({
  question: z.string().min(3).max(500),
});

// POST /api/v1/feedback/ask — natural-language question over the workspace's
// feedback. Costs CREDIT_COSTS.ask_query credits; quota is checked BEFORE the
// LLM call and only charged after a successful (confidence > 0) answer.
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

// Monthly AI credit quota (per plan) — DB-side sum over usage_logs, checked
// BEFORE any LLM spend. Paged because PostgREST caps result sets at 1000 rows.
async function assertCreditQuota(workspaceId: string, cost: number): Promise<void> {
  const db = getServiceDb();
  const { data: workspace, error } = await db
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .single<{ plan: PlanType }>();
  if (error || !workspace) {
    throw new Error(`[feedback/ask] workspace lookup failed: ${error?.message ?? 'not found'}`);
  }

  const limit = PLAN_LIMITS[workspace.plan]?.ai_credits ?? PLAN_LIMITS.starter.ai_credits;
  if (!Number.isFinite(limit)) return; // unlimited

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const PAGE_SIZE = 1000;
  let used = 0;
  for (let page = 0; page < 20; page++) {
    const from = page * PAGE_SIZE;
    const { data, error: sumError } = await db
      .from('usage_logs')
      .select('credits_used')
      .eq('workspace_id', workspaceId)
      .gte('created_at', monthStart.toISOString())
      .range(from, from + PAGE_SIZE - 1)
      .returns<{ credits_used: number | null }[]>();
    if (sumError) {
      throw new Error(`[feedback/ask] quota sum failed: ${sumError.message}`);
    }
    const rows = data ?? [];
    for (const row of rows) used += Number(row.credits_used ?? 0);
    if (used + cost > limit || rows.length < PAGE_SIZE) break;
  }

  if (used + cost > limit) {
    throw new ApiError(
      402,
      `Monthly AI credit limit reached (${used}/${limit} credits on the ${workspace.plan} plan).`,
      'quota_exceeded'
    );
  }
}
