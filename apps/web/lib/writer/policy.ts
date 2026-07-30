import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';

export type WriterWorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type WriterPolicyMode = 'approval_required';

export interface WriterPolicy {
  enabled: boolean;
  mode: WriterPolicyMode;
  allowedConnectionIds: string[];
  dailyPostCap: number;
  weeklyCreditCap: number;
  minimumSignalStrength: number;
  contentMix: Record<string, number>;
  quietDays: number[];
  timezone: string;
  dnaProfileId: string | null;
  policyVersion: number;
}

export interface WriterPolicyRow {
  workspace_id: string;
  enabled: boolean;
  mode: WriterPolicyMode;
  allowed_connection_ids: string[];
  daily_post_cap: number;
  weekly_credit_cap: number;
  minimum_signal_strength: number;
  content_mix: Record<string, number>;
  quiet_days: number[];
  timezone: string;
  dna_profile_id: string | null;
  policy_version: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export type WriterPolicyPatch = Partial<
  Omit<WriterPolicy, 'mode' | 'policyVersion'>
>;

export const WRITER_POLICY_COLUMNS = [
  'workspace_id',
  'enabled',
  'mode',
  'allowed_connection_ids',
  'daily_post_cap',
  'weekly_credit_cap',
  'minimum_signal_strength',
  'content_mix',
  'quiet_days',
  'timezone',
  'dna_profile_id',
  'policy_version',
  'updated_by',
  'created_at',
  'updated_at',
].join(', ');

export const DEFAULT_WRITER_POLICY: WriterPolicy = Object.freeze({
  enabled: false,
  mode: 'approval_required',
  allowedConnectionIds: [],
  dailyPostCap: 1,
  weeklyCreditCap: 10,
  minimumSignalStrength: 0.6,
  contentMix: {},
  quietDays: [],
  timezone: 'Europe/Berlin',
  dnaProfileId: null,
  policyVersion: 1,
});

export const WRITER_MIGRATION_PENDING = new ApiError(
  503,
  'Writer pilot storage is not set up yet — apply supabase/migrations/022_writer_pilot.sql.',
  'migration_pending'
);

function throwWriterDbError(
  error: { code?: string | null; message?: string | null } | null,
  operation: string
): never {
  if (isMissingSchemaError(error?.code)) throw WRITER_MIGRATION_PENDING;
  throw new Error(`Writer ${operation} failed: ${error?.message ?? 'unknown database error'}`);
}

export function policyFromRow(row: WriterPolicyRow): WriterPolicy {
  return {
    enabled: row.enabled,
    mode: 'approval_required',
    allowedConnectionIds: [...row.allowed_connection_ids],
    dailyPostCap: row.daily_post_cap,
    weeklyCreditCap: row.weekly_credit_cap,
    minimumSignalStrength: row.minimum_signal_strength,
    contentMix: { ...row.content_mix },
    quietDays: [...row.quiet_days],
    timezone: row.timezone,
    dnaProfileId: row.dna_profile_id,
    policyVersion: row.policy_version,
  };
}

export function canManageWriterPolicy(role: WriterWorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

export async function requireWriterOwnerOrAdmin(auth: {
  workspaceId: string;
  method: 'api_key' | 'session';
  userId?: string;
}): Promise<{ role: 'owner' | 'admin'; userId: string }> {
  if (auth.method !== 'session' || !auth.userId) {
    throw new ApiError(
      403,
      'Writer approvals and policy changes require an owner or admin session.',
      'approval_role_required'
    );
  }
  const role = await resolveWriterWorkspaceRole(auth.workspaceId, auth.userId);
  if (!canManageWriterPolicy(role)) {
    throw new ApiError(
      403,
      'Only a workspace owner or admin can perform this Writer action.',
      'approval_role_required'
    );
  }
  return { role: role as 'owner' | 'admin', userId: auth.userId };
}

export async function resolveWriterWorkspaceRole(
  workspaceId: string,
  userId: string
): Promise<WriterWorkspaceRole> {
  const db = getServiceDb();
  const { data: workspace, error: workspaceError } = await db
    .from('workspaces')
    .select('id, owner_id')
    .eq('id', workspaceId)
    .maybeSingle<{ id: string; owner_id: string }>();

  if (workspaceError) {
    throw new Error(`Writer workspace role lookup failed: ${workspaceError.message}`);
  }
  if (!workspace) {
    throw new ApiError(404, 'Workspace not found.', 'workspace_not_found');
  }
  if (workspace.owner_id === userId) return 'owner';

  const { data: membership, error: membershipError } = await db
    .from('workspace_members')
    .select('workspace_id, user_id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle<{ workspace_id: string; user_id: string; role: string }>();

  if (membershipError) {
    throw new Error(`Writer workspace membership lookup failed: ${membershipError.message}`);
  }
  if (!membership || !['admin', 'member', 'viewer'].includes(membership.role)) {
    throw new ApiError(403, 'You are not a member of this workspace.', 'forbidden');
  }
  return membership.role as Exclude<WriterWorkspaceRole, 'owner'>;
}

export async function getWriterPolicy(workspaceId: string): Promise<WriterPolicy> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspace_writer_policies')
    .select(WRITER_POLICY_COLUMNS)
    .eq('workspace_id', workspaceId)
    .maybeSingle<WriterPolicyRow>();

  if (error) throwWriterDbError(error, 'policy lookup');
  return data
    ? policyFromRow(data)
    : {
        ...DEFAULT_WRITER_POLICY,
        allowedConnectionIds: [],
        contentMix: {},
        quietDays: [],
      };
}

async function validatePolicyReferences(
  workspaceId: string,
  allowedConnectionIds: readonly string[],
  dnaProfileId: string | null
): Promise<void> {
  const db = getServiceDb();

  if (allowedConnectionIds.length > 0) {
    const uniqueIds = [...new Set(allowedConnectionIds)];
    const { data, error } = await db
      .from('platform_connections')
      .select('id, workspace_id, status')
      .eq('workspace_id', workspaceId)
      .in('id', uniqueIds)
      .returns<Array<{ id: string; workspace_id: string; status: string }>>();
    if (error) throwWriterDbError(error, 'connection validation');
    if (
      (data ?? []).length !== uniqueIds.length ||
      (data ?? []).some((connection) => connection.status !== 'active')
    ) {
      throw new ApiError(
        409,
        'One or more Writer destinations are missing, inactive, or belong to another workspace.',
        'invalid_writer_destinations'
      );
    }
  }

  if (dnaProfileId) {
    const { data, error } = await db
      .from('content_dna_profiles')
      .select('id, workspace_id, status')
      .eq('id', dnaProfileId)
      .eq('workspace_id', workspaceId)
      .maybeSingle<{ id: string; workspace_id: string; status: string }>();
    if (error) throwWriterDbError(error, 'DNA profile validation');
    if (!data || data.status !== 'active') {
      throw new ApiError(
        409,
        'The selected Content DNA profile is not active in this workspace.',
        'invalid_dna_profile'
      );
    }
  }
}

export async function updateWriterPolicy(
  workspaceId: string,
  patch: WriterPolicyPatch,
  updatedBy: string
): Promise<WriterPolicy> {
  const current = await getWriterPolicy(workspaceId);
  const next: WriterPolicy = {
    enabled: patch.enabled ?? current.enabled,
    mode: 'approval_required',
    allowedConnectionIds:
      patch.allowedConnectionIds === undefined
        ? current.allowedConnectionIds
        : [...new Set(patch.allowedConnectionIds)],
    dailyPostCap: patch.dailyPostCap ?? current.dailyPostCap,
    weeklyCreditCap: patch.weeklyCreditCap ?? current.weeklyCreditCap,
    minimumSignalStrength:
      patch.minimumSignalStrength ?? current.minimumSignalStrength,
    contentMix:
      patch.contentMix === undefined ? current.contentMix : { ...patch.contentMix },
    quietDays:
      patch.quietDays === undefined
        ? current.quietDays
        : [...new Set(patch.quietDays)].sort((left, right) => left - right),
    timezone: patch.timezone ?? current.timezone,
    dnaProfileId:
      patch.dnaProfileId === undefined ? current.dnaProfileId : patch.dnaProfileId,
    policyVersion: current.policyVersion + 1,
  };

  await validatePolicyReferences(
    workspaceId,
    next.allowedConnectionIds,
    next.dnaProfileId
  );

  const db = getServiceDb();
  const { data, error } = await db.rpc('update_writer_policy_atomic', {
    p_workspace_id: workspaceId,
    p_expected_version: current.policyVersion,
    p_enabled: next.enabled,
    p_allowed_connection_ids: next.allowedConnectionIds,
    p_daily_post_cap: next.dailyPostCap,
    p_weekly_credit_cap: next.weeklyCreditCap,
    p_minimum_signal_strength: next.minimumSignalStrength,
    p_content_mix: next.contentMix,
    p_quiet_days: next.quietDays,
    p_timezone: next.timezone,
    p_dna_profile_id: next.dnaProfileId,
    p_updated_by: updatedBy,
  });

  if (error?.code === '40001') {
    throw new ApiError(
      409,
      'The Writer policy changed concurrently. Reload it and try again.',
      'writer_policy_changed'
    );
  }
  if (error) throwWriterDbError(error, 'policy update');
  const row = (Array.isArray(data) ? data[0] : data) as WriterPolicyRow | null;
  if (!row) throwWriterDbError(null, 'policy update');
  return policyFromRow(row);
}
