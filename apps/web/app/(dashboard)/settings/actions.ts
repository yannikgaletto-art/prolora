'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { renameWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getActiveWorkspace } from '@/lib/workspace/active';

export interface RenameState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

// Session-bound, like onboarding/actions.ts — the workspace comes from
// findWorkspace(supabase) itself, never from a client-supplied id.
export async function renameWorkspaceAction(
  _prevState: RenameState,
  formData: FormData
): Promise<RenameState> {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) {
    return { status: 'error', message: 'Workspace not found.' };
  }

  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { status: 'error', message: 'Workspace name is required.' };
  }
  if (name === workspace.name) {
    return { status: 'idle' };
  }

  try {
    await renameWorkspace(supabase, workspace.id, name.slice(0, 100));
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Rename failed.',
    };
  }

  revalidatePath('/settings');
  return { status: 'success', message: 'Workspace name updated.' };
}
