// Monthly AI credit quota (per plan) — extracted verbatim from
// app/api/v1/feedback/ask/route.ts so every billable AI action shares ONE
// quota gate (GOAL-RUN4 T1-1). Checked BEFORE any LLM spend; charging happens
// at the call sites only after success.
import { PLAN_LIMITS, type PlanType } from '@prolora/shared';
import { ApiError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';

// DB-side sum over usage_logs, paged because PostgREST caps result sets at
// 1000 rows. Workspace-scoped on every query (Invariante 2).
export async function assertCreditQuota(workspaceId: string, cost: number): Promise<void> {
  const db = getServiceDb();
  const { data: workspace, error } = await db
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .single<{ plan: PlanType }>();
  if (error || !workspace) {
    throw new Error(`[usage:credits] workspace lookup failed: ${error?.message ?? 'not found'}`);
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
      throw new Error(`[usage:credits] quota sum failed: ${sumError.message}`);
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
