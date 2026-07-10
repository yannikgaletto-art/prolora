'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  findWorkspace,
  markOnboardingCompleted,
  renameWorkspace,
} from '@/lib/workspace/workspace-lifecycle';

// All actions run on the user's session client: RLS restricts every update to
// the workspace they own.

// F7: step 1 (workspace naming) no longer completes onboarding by itself —
// it renames the workspace (if changed) and advances the wizard to step 2.
// markOnboardingCompleted only fires once the wizard is actually finished
// (finishOnboarding below) or explicitly skipped (skipOnboarding).
export async function continueFromNaming(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const name = String(formData.get('name') ?? '').trim();
  if (name && name !== workspace.name) {
    await renameWorkspace(supabase, workspace.id, name.slice(0, 100));
  }

  redirect('/onboarding?step=2');
}

// Reused as-is from F0: skipping from any step marks onboarding completed
// immediately and drops the user straight into /publish.
export async function skipOnboarding(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  await markOnboardingCompleted(supabase, workspace.id);

  redirect('/publish');
}

// F7: step 3 completion. Both the "first post" and "first feedback source"
// paths funnel through this action (via a plain <form action> for the post
// path, or a hidden auto-submitted form after a successful client-side
// mutation for the feedback path) — it marks onboarding complete and sends
// the user to whichever surface matches the path they picked.
export async function finishOnboarding(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  await markOnboardingCompleted(supabase, workspace.id);

  const destination = String(formData.get('destination') ?? '');
  redirect(destination === 'listen' ? '/listen' : '/publish');
}
