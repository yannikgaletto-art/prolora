import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { analyzeContentDna } from './dna';
import { hashSampleSet, sha256Hex } from './hash';
import {
  CONTENT_DNA_PROFILE_ROW_COLUMNS,
  type ContentDnaAnalysis,
  type ContentDnaProfileRow,
  type ContentSampleKind,
  type ContentSampleOrigin,
  type ContentSampleRow,
  type DnaLockedRule,
} from './types';

export const MAX_ACTIVE_CONTENT_SAMPLES = 50;

export const CONTENT_DNA_MIGRATION_PENDING = new ApiError(
  503,
  'Content DNA storage is not set up yet — apply supabase/migrations/021_content_dna.sql.',
  'migration_pending'
);

// Embeddings are deliberately absent: no Writer API may expose raw vectors.
const CONTENT_SAMPLE_SAFE_COLUMNS = [
  'id',
  'workspace_id',
  'kind',
  'origin',
  'platform',
  'content',
  'category',
  'hook_type',
  'content_format',
  'masked_content',
  'metadata',
  'source_post_item_id',
  'source_url',
  'label',
  'active',
  'content_hash',
  'created_at',
  'updated_at',
].join(', ');

export interface ContentSampleDto {
  id: string;
  kind: ContentSampleKind;
  origin: ContentSampleOrigin;
  platform: string | null;
  content: string;
  category: string | null;
  hook_type: string | null;
  content_format: string | null;
  metadata: Record<string, unknown>;
  source_post_item_id: string | null;
  source_url: string | null;
  label: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateContentSampleInput {
  kind: ContentSampleKind;
  origin: ContentSampleOrigin;
  content: string;
  platform?: string;
  source_post_item_id?: string;
  source_url?: string;
  label?: string;
}

export interface UpdateContentSampleInput {
  active?: boolean;
  label?: string | null;
}

export type ContentDnaProfileDto = Omit<ContentDnaProfileRow, 'workspace_id'>;

function normalizeSampleContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

function sampleDto(row: ContentSampleRow): ContentSampleDto {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    platform: row.platform,
    content: row.content,
    category: row.category,
    hook_type: row.hook_type,
    content_format: row.content_format,
    metadata: row.metadata,
    source_post_item_id: row.source_post_item_id,
    source_url: row.source_url,
    label: row.label,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function profileDto(row: ContentDnaProfileRow): ContentDnaProfileDto {
  const { workspace_id: _workspaceId, ...profile } = row;
  return profile;
}

function throwStorageError(context: string, error: { code?: string | null; message: string }): never {
  if (isMissingSchemaError(error.code)) throw CONTENT_DNA_MIGRATION_PENDING;
  throw new Error(`[writer] ${context}: ${error.message}`);
}

function isMissingNamedRpc(
  error: { code?: string | null; message: string },
  rpcName: string
): boolean {
  return (
    error.message.includes(rpcName) &&
    ((error.code === 'PGRST202' && /could not find/i.test(error.message)) ||
      (error.code === '42883' && /does not exist/i.test(error.message)))
  );
}

function throwRpcError(
  context: string,
  rpcName: string,
  error: { code?: string | null; message: string }
): never {
  if (isMissingNamedRpc(error, rpcName)) throw CONTENT_DNA_MIGRATION_PENDING;
  if (error.code === 'P0001' && error.message.includes('content_sample_limit_reached')) {
    throw new ApiError(
      409,
      `A workspace can have at most ${MAX_ACTIVE_CONTENT_SAMPLES} active Content DNA samples.`,
      'sample_limit_reached'
    );
  }
  if (error.code === '40001' && error.message.includes('content_sample_set_changed')) {
    throw new ApiError(
      409,
      'Content DNA samples changed during rebuild. Retry with the current sample set.',
      'sample_set_changed'
    );
  }
  throwStorageError(context, error);
}

function singleRpcRow<T>(data: unknown): T | null {
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length > 1) throw new Error('[writer] atomic RPC returned more than one row');
  return (rows[0] as T | undefined) ?? null;
}

async function assertSourcePostOwnership(
  workspaceId: string,
  sourcePostItemId: string
): Promise<void> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_items')
    .select('id, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', workspaceId)
    .eq('id', sourcePostItemId)
    .maybeSingle<{ id: string }>();
  if (error) throwStorageError('source post ownership check failed', error);
  if (!data) {
    throw new ApiError(
      400,
      'The source post item does not belong to the authenticated workspace.',
      'invalid_source_post'
    );
  }
}

async function loadActiveSampleRows(workspaceId: string): Promise<ContentSampleRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .select(CONTENT_SAMPLE_SAFE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .returns<ContentSampleRow[]>();
  if (error) throwStorageError('active sample list failed', error);
  return data ?? [];
}

export async function listContentSamples(workspaceId: string): Promise<ContentSampleDto[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .select(CONTENT_SAMPLE_SAFE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .returns<ContentSampleRow[]>();
  if (error) throwStorageError('sample list failed', error);
  return (data ?? []).map(sampleDto);
}

export async function createContentSample(
  workspaceId: string,
  input: CreateContentSampleInput
): Promise<ContentSampleDto> {
  if (input.source_post_item_id) {
    await assertSourcePostOwnership(workspaceId, input.source_post_item_id);
  }
  const content = normalizeSampleContent(input.content);
  const db = getServiceDb();
  const rpcName = 'create_content_sample_atomic';
  const { data, error } = await db.rpc(rpcName, {
    p_workspace_id: workspaceId,
    p_kind: input.kind,
    p_origin: input.origin,
    p_platform: input.platform ?? null,
    p_content: content,
    p_source_post_item_id: input.source_post_item_id ?? null,
    p_source_url: input.source_url ?? null,
    p_label: input.label ?? null,
    p_content_hash: sha256Hex(content),
  });
  const row = singleRpcRow<ContentSampleRow>(data);
  if (error || !row) {
    if (error?.code === '23505') {
      throw new ApiError(
        409,
        'This Content DNA sample already exists in the workspace.',
        'duplicate_sample'
      );
    }
    if (error) throwRpcError('sample insert failed', rpcName, error);
    throw new Error('[writer] sample insert returned no row');
  }
  return sampleDto(row);
}

export async function updateContentSample(
  workspaceId: string,
  sampleId: string,
  input: UpdateContentSampleInput
): Promise<ContentSampleDto | null> {
  const db = getServiceDb();
  const rpcName = 'update_content_sample_atomic';
  const { data, error } = await db.rpc(rpcName, {
    p_workspace_id: workspaceId,
    p_sample_id: sampleId,
    p_set_active: input.active !== undefined,
    p_active: input.active ?? null,
    p_set_label: input.label !== undefined,
    p_label: input.label ?? null,
  });
  if (error) throwRpcError('sample update failed', rpcName, error);
  const row = singleRpcRow<ContentSampleRow>(data);
  return row ? sampleDto(row) : null;
}

export async function deleteContentSample(
  workspaceId: string,
  sampleId: string
): Promise<boolean> {
  const db = getServiceDb();
  const rpcName = 'delete_content_sample_atomic';
  const { data, error } = await db.rpc(rpcName, {
    p_workspace_id: workspaceId,
    p_sample_id: sampleId,
  });
  if (error) throwRpcError('sample delete failed', rpcName, error);
  return data === sampleId;
}

async function activeProfileRow(workspaceId: string): Promise<ContentDnaProfileRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_dna_profiles')
    .select(CONTENT_DNA_PROFILE_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .maybeSingle<ContentDnaProfileRow>();
  if (error) throwStorageError('active DNA profile lookup failed', error);
  return data;
}

export async function getContentDna(
  workspaceId: string
): Promise<
  | { dnaProfile: ContentDnaProfileDto; fallback: null }
  | { dnaProfile: null; fallback: ContentDnaAnalysis }
> {
  const active = await activeProfileRow(workspaceId);
  if (active) return { dnaProfile: profileDto(active), fallback: null };
  const samples = await loadActiveSampleRows(workspaceId);
  return {
    dnaProfile: null,
    fallback: analyzeContentDna(
      samples.map((sample) => ({
        kind: sample.kind,
        content: sample.masked_content ?? sample.content,
        active: sample.active,
      }))
    ),
  };
}

export async function rebuildContentDna(workspaceId: string): Promise<ContentDnaProfileDto> {
  const samples = await loadActiveSampleRows(workspaceId);
  const currentActive = await activeProfileRow(workspaceId);
  const lockedRules: DnaLockedRule[] = currentActive?.locked_rules ?? [];
  const analysis = analyzeContentDna(
    samples.map((sample) => ({
      kind: sample.kind,
      content: sample.masked_content ?? sample.content,
      active: sample.active,
    })),
    lockedRules
  );
  const sampleSetHash = hashSampleSet(
    samples.map((sample) => ({
      kind: sample.kind,
      contentHash: sample.content_hash,
      maskedContentHash:
        typeof sample.metadata?.maskedContentHash === 'string'
          ? sample.metadata.maskedContentHash
          : sample.masked_content ? sha256Hex(sample.masked_content) : undefined,
      platform: sample.platform,
      category: sample.category ?? null,
      hookType: sample.hook_type ?? null,
      contentFormat: sample.content_format ?? null,
      active: sample.active,
    }))
  );
  const sampleSetMembers = samples
    .map((sample) => `${sample.kind}:${sample.content_hash}`)
    .sort();
  const db = getServiceDb();
  const rpcName = 'rebuild_content_dna_atomic';
  const { data, error } = await db.rpc(rpcName, {
    p_workspace_id: workspaceId,
    p_sample_set_members: sampleSetMembers,
    p_sample_set_hash: sampleSetHash,
    p_schema_version: 'content-dna-v2',
    p_profile: analysis.profile,
    p_confidence: analysis.confidence,
    p_prompt_rules: analysis.promptRules,
    p_locked_rules: lockedRules,
    p_sample_count: analysis.sampleCount,
    p_model: 'deterministic-v1',
    p_prompt_version: 'writer-dna-v2',
  });
  if (error) throwRpcError('DNA profile rebuild failed', rpcName, error);
  const activated = singleRpcRow<ContentDnaProfileRow>(data);
  if (!activated || activated.status !== 'active') {
    throw new Error('[writer] DNA profile rebuild returned no active row');
  }
  return profileDto(activated);
}
