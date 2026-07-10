// F6 Settings: plan + this-month usage for the Plan tab. Plain lib reads (not
// Server Actions) — called only from Server Components that already resolved
// workspaceId from the caller's own session (Invariante 2), same convention
// as lib/board/board-service.ts and lib/changelog/changelog-service.ts.

import { getServiceDb } from '@/lib/db';
import type { PlanType } from '@prolora/shared';

export async function getWorkspacePlan(workspaceId: string): Promise<PlanType> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .single<{ plan: PlanType }>();
  if (error || !data) {
    throw new Error(`[settings/usage] plan lookup failed: ${error?.message ?? 'no row'}`);
  }
  return data.plan;
}

// post_groups has no month index of its own — filtering by created_at is the
// same approach the posts GET route already uses for date_from/date_to.
export async function getMonthlyPostCount(workspaceId: string): Promise<number> {
  const db = getServiceDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { count, error } = await db
    .from('post_groups')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .gte('created_at', monthStart);
  if (error) {
    throw new Error(`[settings/usage] post count failed: ${error.message}`);
  }
  return count ?? 0;
}
