// Active-workspace resolution (GOAL-RUN9 §9 T3.1). The cookie only INFLUENCES
// which of the caller's OWN workspaces is active — findWorkspace validates it
// against the RLS-scoped list, and the API layer re-verifies membership on
// every request (auth-middleware honors x-workspace-id with its own check).
// Deliberately NOT httpOnly: the client API helper mirrors it into the
// x-workspace-id header so session API calls hit the same workspace.
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findWorkspace, type WorkspaceSummary } from './workspace-lifecycle';

export const ACTIVE_WORKSPACE_COOKIE = 'prolora_ws';

export async function getActiveWorkspace(
  supabase: SupabaseClient
): Promise<WorkspaceSummary | null> {
  const store = await cookies();
  const preferred = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return findWorkspace(supabase, preferred);
}

/** Server actions only — page renders must never mutate cookies. */
export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}
