import type { SupabaseClient } from '@supabase/supabase-js';

// Workspace lifecycle (F0-1). Runs against the CALLER'S session client, never
// the service-role client: RLS already permits exactly what we need
// (workspace_insert: owner_id = auth.uid(); members_manage: owner of the row).
// That keeps this module importable from Edge middleware, where the
// service-role client (a `require()` of @supabase/supabase-js) cannot run.
//
// Schema reality: `workspaces` has no onboarding_completed column. The flag
// lives in the `settings` JSONB blob.

const SLUG_CONFLICT = '23505';
const MAX_SLUG_ATTEMPTS = 3;

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string | null;
  onboardingCompleted: boolean;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string | null;
  settings: Record<string, unknown> | null;
}

function toSummary(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    onboardingCompleted: row.settings?.onboarding_completed === true,
  };
}

// "yannik.galetto@gmail.com" -> "yannik-galetto"
function emailPrefix(email: string): string {
  return email.split('@')[0] ?? 'workspace';
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'workspace';
}

// Slug is globally unique. Collisions are resolved by suffixing, not by
// failing the user's first login.
function slugCandidate(base: string, attempt: number): string {
  if (attempt === 0) return base;
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function findWorkspace(supabase: SupabaseClient): Promise<WorkspaceSummary | null> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, slug, settings')
    .order('created_at', { ascending: true })
    .limit(1)
    .returns<WorkspaceRow[]>();

  if (error) {
    throw new Error(`[workspace] lookup failed: ${error.message}`);
  }
  const row = data?.[0];
  return row ? toSummary(row) : null;
}

async function createWorkspace(
  supabase: SupabaseClient,
  userId: string,
  email: string
): Promise<WorkspaceSummary> {
  const name = emailPrefix(email);
  const baseSlug = slugify(name);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('workspaces')
      .insert({
        name,
        slug: slugCandidate(baseSlug, attempt),
        owner_id: userId,
        plan: 'starter',
        settings: { onboarding_completed: false },
      })
      .select('id, name, slug, settings')
      .single<WorkspaceRow>();

    if (error) {
      if (error.code === SLUG_CONFLICT) continue;
      throw new Error(`[workspace] create failed: ${error.message}`);
    }

    // The owner must also be a member: every workspace-scoped query in the
    // backend resolves the tenant through workspace_members.
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({ workspace_id: data.id, user_id: userId, role: 'admin' });
    if (memberError && memberError.code !== SLUG_CONFLICT) {
      throw new Error(`[workspace] member insert failed: ${memberError.message}`);
    }

    console.log(`[workspace] provisioned ${data.id} (${data.slug}) for user ${userId}`);
    return toSummary(data);
  }

  throw new Error(`[workspace] create failed: no free slug after ${MAX_SLUG_ATTEMPTS} attempts`);
}

// First login  -> no workspace -> auto-create (onboarding_completed = false)
// Later logins -> existing workspace is returned untouched.
export async function ensureWorkspace(
  supabase: SupabaseClient,
  userId: string,
  email: string
): Promise<WorkspaceSummary> {
  const existing = await findWorkspace(supabase);
  if (existing) return existing;
  return createWorkspace(supabase, userId, email);
}

// Merges into settings instead of overwriting — the blob holds other keys.
export async function markOnboardingCompleted(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .single<{ settings: Record<string, unknown> | null }>();
  if (error) {
    throw new Error(`[workspace] settings read failed: ${error.message}`);
  }

  const { error: updateError } = await supabase
    .from('workspaces')
    .update({ settings: { ...(data.settings ?? {}), onboarding_completed: true } })
    .eq('id', workspaceId);
  if (updateError) {
    throw new Error(`[workspace] onboarding flag update failed: ${updateError.message}`);
  }

  console.log(`[workspace] onboarding completed for ${workspaceId}`);
}

export async function renameWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  name: string
): Promise<void> {
  const { error } = await supabase.from('workspaces').update({ name }).eq('id', workspaceId);
  if (error) {
    throw new Error(`[workspace] rename failed: ${error.message}`);
  }
}
