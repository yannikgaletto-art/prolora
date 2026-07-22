'use server';

// Product library actions (GOAL-RUN9 §9). Switching only sets the cookie —
// findWorkspace validates it against the RLS-scoped membership list, and the
// API layer re-verifies membership per request. Creating uses the session
// client, so RLS enforces owner_id = auth.uid().
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createProductWorkspace, listWorkspaces } from '@/lib/workspace/workspace-lifecycle';
import { setActiveWorkspace } from '@/lib/workspace/active';

export async function switchProduct(workspaceId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const workspaces = await listWorkspaces(supabase);
  const target = workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) return; // stale id — silently ignore, UI reloads the real list
  await setActiveWorkspace(target.id);
  redirect('/publish/start');
}

export async function addProduct(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 60) return;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await createProductWorkspace(supabase, user.id, name);
  await setActiveWorkspace(workspace.id);
  redirect('/product');
}
