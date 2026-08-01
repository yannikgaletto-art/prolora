import { ApiError } from '@/lib/api/http';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import { WRITER_MIGRATION_PENDING, type WriterWorkspaceRole } from './policy';
import {
  getWriterReview,
  loadWriterApprovalContext,
  validateWriterApproval,
} from './reviews';

export interface MaterializedWriterBundle {
  postGroupId: string;
  created: boolean;
}

interface MaterializeWriterBundleRow {
  post_group_id: string;
  created: boolean;
}

function isMissingMaterializeFunction(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  return (
    isMissingSchemaError(error.code) ||
    (Boolean(error.message?.includes('materialize_writer_bundle_with_qa')) &&
      ((error.code === 'PGRST202' && /could not find/iu.test(error.message ?? '')) ||
        (error.code === '42883' && /does not exist/iu.test(error.message ?? ''))))
  );
}

function materializeConflict(message: string | null | undefined): ApiError {
  if (message?.toLocaleLowerCase().includes('stale')) {
    return new ApiError(409, 'This Writer review is stale.', 'stale_review');
  }
  return new ApiError(
    409,
    'The Writer review could not be materialized because its approval context changed.',
    'approval_context_changed'
  );
}

export async function materializeWriterBundle(
  workspaceId: string,
  reviewId: string,
  snapshotHash: string,
  approverId: string,
  approverRole: WriterWorkspaceRole
): Promise<MaterializedWriterBundle> {
  const { data, error } = await getServiceDb().rpc('materialize_writer_bundle_with_qa', {
    p_workspace_id: workspaceId,
    p_review_id: reviewId,
    p_snapshot_hash: snapshotHash,
    p_approver_id: approverId,
    p_approver_role: approverRole,
  });
  if (error) {
    if (isMissingMaterializeFunction(error)) throw WRITER_MIGRATION_PENDING;
    if (error.code === '42501') {
      throw new ApiError(
        403,
        'Your Writer approval role changed. Reload and try again.',
        'approval_role_required'
      );
    }
    if (['22023', '40001', 'P0002'].includes(error.code ?? '')) {
      throw materializeConflict(error.message);
    }
    throw new Error(`Writer materialization failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | MaterializeWriterBundleRow
    | null;
  if (!row?.post_group_id) {
    throw new Error('Writer materialization returned no post group.');
  }
  return { postGroupId: row.post_group_id, created: row.created };
}

export async function approveWriterReview(
  workspaceId: string,
  reviewId: string,
  userId: string,
  role: WriterWorkspaceRole,
  suppliedSnapshotHash: string,
  selectedChannelIds?: readonly string[]
): Promise<MaterializedWriterBundle> {
  const review = await getWriterReview(workspaceId, reviewId);
  if (selectedChannelIds) {
    const expected = review.snapshot.variants.map((variant) => variant.id).sort();
    const selected = [...new Set(selectedChannelIds)].sort();
    if (
      expected.length !== selected.length ||
      expected.some((id, index) => id !== selected[index])
    ) {
      throw new ApiError(
        409,
        'The approved destinations must exactly match this immutable review.',
        'approval_context_changed'
      );
    }
  }

  if (review.status === 'approved') {
    if (suppliedSnapshotHash !== review.snapshot_hash) {
      throw new ApiError(409, 'This Writer review is stale.', 'stale_review');
    }
    if (role !== 'owner' && role !== 'admin') {
      throw new ApiError(
        403,
        'Only a workspace owner or admin can approve Writer reviews.',
        'approval_role_required'
      );
    }
    return materializeWriterBundle(
      workspaceId,
      reviewId,
      suppliedSnapshotHash,
      userId,
      role
    );
  }

  const context = await loadWriterApprovalContext(workspaceId, review);
  validateWriterApproval({
    review,
    suppliedSnapshotHash,
    role,
    connections: context.connections,
    proofs: context.proofs,
  });
  return materializeWriterBundle(
    workspaceId,
    reviewId,
    review.snapshot_hash,
    userId,
    role
  );
}
