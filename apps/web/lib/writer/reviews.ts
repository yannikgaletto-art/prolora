import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { hashCanonicalJson } from './hash';
import type { CanonicalJsonValue } from './types';
import {
  WRITER_MIGRATION_PENDING,
  type WriterWorkspaceRole,
} from './policy';

export type WriterReviewStatus =
  | 'pending'
  | 'approved'
  | 'invalidated'
  | 'rejected'
  | 'expired';

export interface WriterReviewMedia {
  storageKey: string;
  mimeType: string;
  altText: string | null;
  contentHash: string;
}

export interface WriterReviewVariant {
  id: string;
  channelKey: string;
  platform: string;
  connection: {
    id: string;
    platform: string;
    accountId: string | null;
    accountName: string;
  };
  format: 'post' | 'thread' | 'article';
  content: string;
  segments: string[];
  media: WriterReviewMedia[];
  firstComment: string | null;
  proofAssetIds: string[];
  gatePassed: boolean;
  gateResult: Record<string, unknown>;
}

export interface WriterReviewSnapshot {
  contentItem: {
    id: string;
    title: string;
    canonicalContent: string;
  };
  variants: WriterReviewVariant[];
  proposedSlot: {
    scheduledAt: string;
    timezone: string;
  };
  sources: {
    proofAssets: Array<{
      id: string;
      consentStatus: string;
      verifiedAt: string | null;
      contentHash: string;
    }>;
    feedbackItemIds: string[];
    referenceIds: string[];
  };
  dna: {
    profileId: string;
    version: number;
  };
  versions: {
    prompt: string;
    gate: string;
    policy: number;
  };
}

export type WriterReviewSnapshotInput = WriterReviewSnapshot;

export interface BuiltWriterReviewSnapshot {
  snapshot: WriterReviewSnapshot;
  snapshotHash: string;
  variantHashes: Record<string, string>;
  sourceSetHash: string;
}

export interface WriterReviewBundleRow {
  id: string;
  workspace_id: string;
  content_item_id: string;
  status: WriterReviewStatus;
  snapshot: WriterReviewSnapshot;
  snapshot_hash: string;
  variant_hashes: Record<string, string>;
  source_set_hash: string;
  dna_profile_id: string;
  dna_version: number;
  prompt_version: string;
  gate_version: string;
  policy_version: number;
  expires_at: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  superseded_by: string | null;
  created_at: string;
}

export interface WriterApprovalConnection {
  id: string;
  platform: string;
  account_id: string | null;
  account_name: string;
  status: string;
}

export interface WriterApprovalProof {
  id: string;
  consent_status: string;
  verified_at: string | null;
}

export interface ValidateWriterApprovalInput {
  review: WriterReviewBundleRow;
  suppliedSnapshotHash: string;
  role: WriterWorkspaceRole;
  connections: readonly WriterApprovalConnection[];
  proofs: readonly WriterApprovalProof[];
  now?: Date;
}

export const WRITER_REVIEW_COLUMNS = [
  'id',
  'workspace_id',
  'content_item_id',
  'status',
  'snapshot',
  'snapshot_hash',
  'variant_hashes',
  'source_set_hash',
  'dna_profile_id',
  'dna_version',
  'prompt_version',
  'gate_version',
  'policy_version',
  'expires_at',
  'approved_by',
  'approved_at',
  'rejected_by',
  'rejected_at',
  'rejection_reason',
  'superseded_by',
  'created_at',
].join(', ');

function asCanonical(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function canonicalVariant(variant: WriterReviewVariant): WriterReviewVariant {
  return {
    ...variant,
    connection: { ...variant.connection },
    segments: [...variant.segments],
    media: variant.media
      .map((media) => ({ ...media }))
      .sort((left, right) => left.storageKey.localeCompare(right.storageKey)),
    proofAssetIds: sortedUnique(variant.proofAssetIds),
    gateResult: { ...variant.gateResult },
  };
}

export function buildWriterReviewSnapshot(
  input: WriterReviewSnapshotInput
): BuiltWriterReviewSnapshot {
  const variants = input.variants
    .map(canonicalVariant)
    .sort((left, right) => left.id.localeCompare(right.id));
  const sources = {
    proofAssets: input.sources.proofAssets
      .map((proof) => ({ ...proof }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    feedbackItemIds: sortedUnique(input.sources.feedbackItemIds),
    referenceIds: sortedUnique(input.sources.referenceIds),
  };
  const snapshot: WriterReviewSnapshot = {
    contentItem: { ...input.contentItem },
    variants,
    proposedSlot: { ...input.proposedSlot },
    sources,
    dna: { ...input.dna },
    versions: { ...input.versions },
  };

  return {
    snapshot,
    snapshotHash: hashCanonicalJson(asCanonical(snapshot)),
    variantHashes: Object.fromEntries(
      variants.map((variant) => [variant.id, hashCanonicalJson(asCanonical(variant))])
    ),
    sourceSetHash: hashCanonicalJson(asCanonical(sources)),
  };
}

export function canApproveWriterReview(role: WriterWorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

function approvalContextChanged(): ApiError {
  return new ApiError(
    409,
    'The review destinations or source consent changed. Generate a fresh review.',
    'approval_context_changed'
  );
}

export function validateWriterApproval(input: ValidateWriterApprovalInput): void {
  const { review, suppliedSnapshotHash, role, connections, proofs } = input;
  if (!canApproveWriterReview(role)) {
    throw new ApiError(
      403,
      'Only a workspace owner or admin can approve Writer reviews.',
      'approval_role_required'
    );
  }
  if (review.status !== 'pending') {
    throw new ApiError(409, 'This Writer review is no longer pending.', 'review_not_pending');
  }
  if (new Date(review.expires_at).getTime() <= (input.now ?? new Date()).getTime()) {
    throw new ApiError(409, 'This Writer review has expired.', 'review_expired');
  }

  const canonicalHash = hashCanonicalJson(asCanonical(review.snapshot));
  if (
    suppliedSnapshotHash !== review.snapshot_hash ||
    canonicalHash !== review.snapshot_hash
  ) {
    throw new ApiError(
      409,
      'This Writer review is stale. Reload or generate a fresh review.',
      'stale_review'
    );
  }

  const expectedConnections = new Map(
    review.snapshot.variants.map((variant) => [variant.connection.id, variant.connection])
  );
  if (connections.length !== expectedConnections.size) throw approvalContextChanged();
  for (const connection of connections) {
    const expected = expectedConnections.get(connection.id);
    if (
      !expected ||
      connection.status !== 'active' ||
      connection.platform !== expected.platform ||
      connection.account_id !== expected.accountId ||
      connection.account_name !== expected.accountName
    ) {
      throw approvalContextChanged();
    }
  }

  const expectedProofs = new Map(
    review.snapshot.sources.proofAssets.map((proof) => [proof.id, proof])
  );
  if (proofs.length !== expectedProofs.size) throw approvalContextChanged();
  for (const proof of proofs) {
    const expected = expectedProofs.get(proof.id);
    if (
      !expected ||
      !['not_required', 'granted'].includes(proof.consent_status) ||
      proof.consent_status !== expected.consentStatus ||
      proof.verified_at !== expected.verifiedAt
    ) {
      throw approvalContextChanged();
    }
  }
}

function throwReviewDbError(
  error: { code?: string | null; message?: string | null } | null,
  operation: string
): never {
  if (isMissingSchemaError(error?.code)) throw WRITER_MIGRATION_PENDING;
  throw new Error(`Writer review ${operation} failed: ${error?.message ?? 'unknown database error'}`);
}

export async function getWriterReview(
  workspaceId: string,
  reviewId: string
): Promise<WriterReviewBundleRow> {
  const { data, error } = await getServiceDb()
    .from('writer_review_bundles')
    .select(WRITER_REVIEW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('id', reviewId)
    .maybeSingle<WriterReviewBundleRow>();
  if (error) throwReviewDbError(error, 'lookup');
  if (!data) throw new ApiError(404, 'Writer review not found.', 'review_not_found');
  return data;
}

export async function listWriterReviews(
  workspaceId: string,
  status?: WriterReviewStatus,
  limit = 50
): Promise<WriterReviewBundleRow[]> {
  let query = getServiceDb()
    .from('writer_review_bundles')
    .select(WRITER_REVIEW_COLUMNS)
    .eq('workspace_id', workspaceId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<WriterReviewBundleRow[]>();
  if (error) throwReviewDbError(error, 'list');
  return data ?? [];
}

export async function createWriterReview(
  workspaceId: string,
  input: WriterReviewSnapshotInput,
  expiresAt: string
): Promise<WriterReviewBundleRow> {
  const built = buildWriterReviewSnapshot(input);
  const { data, error } = await getServiceDb()
    .from('writer_review_bundles')
    .insert({
      workspace_id: workspaceId,
      content_item_id: built.snapshot.contentItem.id,
      snapshot: built.snapshot,
      snapshot_hash: built.snapshotHash,
      variant_hashes: built.variantHashes,
      source_set_hash: built.sourceSetHash,
      dna_profile_id: built.snapshot.dna.profileId,
      dna_version: built.snapshot.dna.version,
      prompt_version: built.snapshot.versions.prompt,
      gate_version: built.snapshot.versions.gate,
      policy_version: built.snapshot.versions.policy,
      expires_at: expiresAt,
    })
    .select(WRITER_REVIEW_COLUMNS)
    .single<WriterReviewBundleRow>();
  if (error || !data) throwReviewDbError(error, 'creation');
  return data;
}

export async function loadWriterApprovalContext(
  workspaceId: string,
  review: WriterReviewBundleRow
): Promise<{
  connections: WriterApprovalConnection[];
  proofs: WriterApprovalProof[];
}> {
  const db = getServiceDb();
  const connectionIds = sortedUnique(
    review.snapshot.variants.map((variant) => variant.connection.id)
  );
  const proofIds = sortedUnique(
    review.snapshot.sources.proofAssets.map((proof) => proof.id)
  );

  const [connectionResult, proofResult] = await Promise.all([
    connectionIds.length === 0
      ? Promise.resolve({ data: [] as WriterApprovalConnection[], error: null })
      : db
          .from('platform_connections')
          .select('id, platform, account_id, account_name, status')
          .eq('workspace_id', workspaceId)
          .in('id', connectionIds)
          .returns<WriterApprovalConnection[]>(),
    proofIds.length === 0
      ? Promise.resolve({ data: [] as WriterApprovalProof[], error: null })
      : db
          .from('proof_assets')
          .select('id, consent_status, verified_at')
          .eq('workspace_id', workspaceId)
          .in('id', proofIds)
          .returns<WriterApprovalProof[]>(),
  ]);
  if (connectionResult.error) {
    throwReviewDbError(connectionResult.error, 'connection reload');
  }
  if (proofResult.error) throwReviewDbError(proofResult.error, 'proof reload');
  return {
    connections: connectionResult.data ?? [],
    proofs: proofResult.data ?? [],
  };
}

export async function recordWriterApprover(
  workspaceId: string,
  reviewId: string,
  snapshotHash: string,
  userId: string
): Promise<void> {
  const { data, error } = await getServiceDb()
    .from('writer_review_bundles')
    .update({ approved_by: userId })
    .eq('workspace_id', workspaceId)
    .eq('id', reviewId)
    .eq('status', 'pending')
    .eq('snapshot_hash', snapshotHash)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) throwReviewDbError(error, 'approval fence');
  if (!data) {
    throw new ApiError(
      409,
      'This Writer review changed before approval.',
      'stale_review'
    );
  }
}

export async function rejectWriterReview(
  workspaceId: string,
  reviewId: string,
  snapshotHash: string,
  userId: string,
  reason: string
): Promise<WriterReviewBundleRow> {
  const { data, error } = await getServiceDb()
    .from('writer_review_bundles')
    .update({
      status: 'rejected',
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason.trim(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', reviewId)
    .eq('status', 'pending')
    .eq('snapshot_hash', snapshotHash)
    .select(WRITER_REVIEW_COLUMNS)
    .maybeSingle<WriterReviewBundleRow>();
  if (error) throwReviewDbError(error, 'rejection');
  if (!data) {
    throw new ApiError(409, 'This Writer review is no longer pending.', 'review_not_pending');
  }
  return data;
}

export async function requestWriterReviewChange(
  workspaceId: string,
  reviewId: string,
  snapshotHash: string,
  reason: string
): Promise<WriterReviewBundleRow> {
  const { data, error } = await getServiceDb()
    .from('writer_review_bundles')
    .update({
      status: 'invalidated',
      rejection_reason: reason.trim(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', reviewId)
    .eq('status', 'pending')
    .eq('snapshot_hash', snapshotHash)
    .select(WRITER_REVIEW_COLUMNS)
    .maybeSingle<WriterReviewBundleRow>();
  if (error) throwReviewDbError(error, 'change request');
  if (!data) {
    throw new ApiError(409, 'This Writer review is no longer pending.', 'review_not_pending');
  }
  return data;
}
