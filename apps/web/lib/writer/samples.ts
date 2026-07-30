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

async function activeSampleCount(workspaceId: string): Promise<number> {
  const db = getServiceDb();
  const { count, error } = await db
    .from('content_samples')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('active', true);
  if (error) throwStorageError('active sample count failed', error);
  if (count === null) {
    throw new Error('[writer] active sample capacity is unknown');
  }
  return count;
}

async function assertActiveSampleCapacity(workspaceId: string): Promise<void> {
  if ((await activeSampleCount(workspaceId)) >= MAX_ACTIVE_CONTENT_SAMPLES) {
    throw new ApiError(
      409,
      `A workspace can have at most ${MAX_ACTIVE_CONTENT_SAMPLES} active Content DNA samples.`,
      'sample_limit_reached'
    );
  }
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

async function loadSampleRow(
  workspaceId: string,
  sampleId: string
): Promise<ContentSampleRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .select(CONTENT_SAMPLE_SAFE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', sampleId)
    .maybeSingle<ContentSampleRow>();
  if (error) throwStorageError('sample lookup failed', error);
  return data;
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
  await assertActiveSampleCapacity(workspaceId);
  const content = normalizeSampleContent(input.content);
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .insert({
      workspace_id: workspaceId,
      kind: input.kind,
      origin: input.origin,
      platform: input.platform ?? null,
      content,
      source_post_item_id: input.source_post_item_id ?? null,
      source_url: input.source_url ?? null,
      label: input.label ?? null,
      active: true,
      content_hash: sha256Hex(content),
    })
    .select(CONTENT_SAMPLE_SAFE_COLUMNS)
    .single<ContentSampleRow>();
  if (error || !data) {
    if (error?.code === '23505') {
      throw new ApiError(
        409,
        'This Content DNA sample already exists in the workspace.',
        'duplicate_sample'
      );
    }
    if (error) throwStorageError('sample insert failed', error);
    throw new Error('[writer] sample insert returned no row');
  }
  return sampleDto(data);
}

export async function updateContentSample(
  workspaceId: string,
  sampleId: string,
  input: UpdateContentSampleInput
): Promise<ContentSampleDto | null> {
  const current = await loadSampleRow(workspaceId, sampleId);
  if (!current) return null;
  if (input.active === true && !current.active) {
    await assertActiveSampleCapacity(workspaceId);
  }

  const update: { active?: boolean; label?: string | null } = {};
  if (input.active !== undefined) update.active = input.active;
  if (input.label !== undefined) update.label = input.label;

  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .update(update)
    .eq('workspace_id', workspaceId)
    .eq('id', sampleId)
    .select(CONTENT_SAMPLE_SAFE_COLUMNS)
    .maybeSingle<ContentSampleRow>();
  if (error) throwStorageError('sample update failed', error);
  return data ? sampleDto(data) : null;
}

export async function deleteContentSample(
  workspaceId: string,
  sampleId: string
): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_samples')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', sampleId)
    .select('id');
  if (error) throwStorageError('sample delete failed', error);
  return (data ?? []).length === 1;
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
        content: sample.content,
        active: sample.active,
      }))
    ),
  };
}

async function latestProfileVersion(workspaceId: string): Promise<number> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('content_dna_profiles')
    .select('version')
    .eq('workspace_id', workspaceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<Pick<ContentDnaProfileRow, 'version'>>();
  if (error) throwStorageError('DNA profile version lookup failed', error);
  return data?.version ?? 0;
}

export async function rebuildContentDna(workspaceId: string): Promise<ContentDnaProfileDto> {
  const samples = await loadActiveSampleRows(workspaceId);
  const nextVersion = (await latestProfileVersion(workspaceId)) + 1;
  const currentActive = await activeProfileRow(workspaceId);
  const lockedRules: DnaLockedRule[] = currentActive?.locked_rules ?? [];
  const analysis = analyzeContentDna(
    samples.map((sample) => ({
      kind: sample.kind,
      content: sample.content,
      active: sample.active,
    })),
    lockedRules
  );
  const sampleSetHash = hashSampleSet(
    samples.map((sample) => ({
      kind: sample.kind,
      contentHash: sample.content_hash,
    }))
  );
  const db = getServiceDb();
  const { data: inserted, error: insertError } = await db
    .from('content_dna_profiles')
    .insert({
      workspace_id: workspaceId,
      version: nextVersion,
      status: 'building',
      sample_set_hash: sampleSetHash,
      schema_version: 'content-dna-v1',
      profile: analysis.profile,
      confidence: analysis.confidence,
      locked_rules: lockedRules,
      sample_count: analysis.sampleCount,
      model: 'deterministic-v1',
      prompt_version: 'writer-dna-v1',
    })
    .select(CONTENT_DNA_PROFILE_ROW_COLUMNS)
    .single<ContentDnaProfileRow>();
  if (insertError || !inserted) {
    if (insertError) throwStorageError('DNA building profile insert failed', insertError);
    throw new Error('[writer] DNA building profile insert returned no row');
  }

  // The former active profile remains untouched until the new immutable
  // payload has been read back through the exact workspace/status fence.
  const { data: verifiedBuilding, error: verifyError } = await db
    .from('content_dna_profiles')
    .select(CONTENT_DNA_PROFILE_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', inserted.id)
    .eq('status', 'building')
    .maybeSingle<ContentDnaProfileRow>();
  if (verifyError) throwStorageError('DNA building profile read-back failed', verifyError);
  if (!verifiedBuilding || verifiedBuilding.version !== nextVersion) {
    throw new Error('[writer] DNA building profile read-back verification failed');
  }

  if (currentActive) {
    const { data: superseded, error: supersedeError } = await db
      .from('content_dna_profiles')
      .update({ status: 'superseded' })
      .eq('workspace_id', workspaceId)
      .eq('id', currentActive.id)
      .eq('status', 'active')
      .select('id');
    if (supersedeError) throwStorageError('active DNA profile supersede failed', supersedeError);
    if ((superseded ?? []).length !== 1) {
      throw new Error('[writer] active DNA profile supersede fence was lost');
    }
  }

  const { data: activated, error: activateError } = await db
    .from('content_dna_profiles')
    .update({ status: 'active' })
    .eq('workspace_id', workspaceId)
    .eq('id', inserted.id)
    .eq('status', 'building')
    .select(CONTENT_DNA_PROFILE_ROW_COLUMNS)
    .maybeSingle<ContentDnaProfileRow>();
  if (activateError) throwStorageError('DNA profile activation failed', activateError);
  if (!activated || activated.version !== nextVersion || activated.status !== 'active') {
    throw new Error('[writer] DNA profile activation verification failed');
  }
  return profileDto(activated);
}
