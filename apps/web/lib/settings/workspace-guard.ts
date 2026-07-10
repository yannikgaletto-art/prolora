import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';

// Server Actions are callable directly from the client with arbitrary
// arguments, so a client-supplied workspaceId can never be trusted for
// scoping on its own (Invariante 2). Every settings Server Action re-derives
// the caller's workspace from their own session and requires it to match the
// id the client claims to be acting on before touching the service-role db.
export async function assertOwnWorkspace(workspaceId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace || workspace.id !== workspaceId) {
    throw new Error('Not authorized for this workspace.');
  }
  return workspace.id;
}
