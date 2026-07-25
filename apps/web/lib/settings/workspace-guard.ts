import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listWorkspaces } from '@/lib/workspace/workspace-lifecycle';

// Server Actions are callable directly from the client with arbitrary
// arguments, so a client-supplied workspaceId can never be trusted for
// scoping on its own (Invariante 2). Every settings Server Action re-derives
// the caller's OWN workspaces from their session and requires the claimed id
// to be one of them before touching the service-role db.
//
// GOAL-RUN9 §9 (1 Workspace = 1 Produkt): the check is membership-in-list,
// not equality with a single "the" workspace. The earlier findWorkspace()
// form always resolved to the oldest workspace, so every other product the
// switcher can select was rejected — which crashed /settings whenever the
// active product was not the first one.
export async function assertOwnWorkspace(workspaceId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const workspaces = await listWorkspaces(supabase);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    throw new Error('Not authorized for this workspace.');
  }
  return workspace.id;
}
