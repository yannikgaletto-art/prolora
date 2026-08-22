import { randomUUID } from 'node:crypto';
import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { CONNECTION_ROW_COLUMNS, POST_ITEM_ROW_COLUMNS, getServiceDb, type ConnectionRow, type PostGroupRow, type PostItemRow, type MediaRef } from '@/lib/db';
import { assertAiPostQaFreshForWorkspace } from '@/lib/pipeline/ai-post-qa';
import { getValidToken, refreshConnectionToken } from '@/lib/auth/token-manager';
import { createAdapter } from '@/lib/adapters';
import { PlatformError, type MediaAttachment, type RateLimitInfo } from '@/lib/adapters/types';
import { prepareImageForPlatform, createSignedMediaUrl } from '@/lib/media/transform';
import { legacyReconciliationMessage } from '@/lib/posts/reconciliation-state';
import { isAutomationEnabled } from '@/lib/system/kill-switch';

const POST_GROUP_PUBLISH_COLUMNS = [
  'id',
  'workspace_id',
  'original_content',
  'media',
  'scheduled_at',
  'scheduled_tz',
  'adapt_content',
  'first_comment',
  'content_source_id',
  'created_at',
  'created_via',
].join(', ');

export interface PublishAttemptResult {
  outcome: 'published' | 'rate_limited' | 'retryable' | 'unknown' | 'failed';
  platformPostId?: string;
  platformUrl?: string;
  errorMessage?: string;
  retryAtIso?: string;
  rateLimit?: { remaining: number; limit: number; reset_at: string } | null;
}

interface ClaimPostItemInput {
  workspaceId: string;
  postItemId: string;
  attemptId: string;
  leaseUntil: string;
}

interface ReconciledExpiredPostItemClaim {
  post_item_id: string;
  workspace_id: string;
}

export function createPostItemClaim(
  workspaceId: string,
  postItemId: string,
  now: Date = new Date()
): ClaimPostItemInput {
  return {
    workspaceId,
    postItemId,
    attemptId: randomUUID(),
    leaseUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function reconcileExpiredPostItemClaims(
  now: Date = new Date(),
  limit = 200
): Promise<Array<{ postItemId: string; workspaceId: string }>> {
  const db = getServiceDb();
  const { data, error } = await db.rpc('reconcile_expired_post_item_claims', {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (error) {
    if (isMissingNamedRpc(error, 'reconcile_expired_post_item_claims')) return [];
    throw new Error(`[publish-post] expired claim reconciliation failed: ${error.message}`);
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as
    ReconciledExpiredPostItemClaim[];
  return rows.map((row) => ({
    postItemId: row.post_item_id,
    workspaceId: row.workspace_id,
  }));
}

function isMissingNamedRpc(
  error: { code?: string | null; message?: string | null },
  rpcName: string
): boolean {
  const message = error.message ?? '';
  if (!message.includes(rpcName)) return false;
  if (error.code === '42883') return /function[\s\S]*does not exist/i.test(message);
  if (error.code === 'PGRST202') return /could not find[\s\S]*function/i.test(message);
  return false;
}

/**
 * Returns true only for the transactionally locked winner. The compatibility
 * path is intentionally limited to a missing Migration 020 RPC and still uses
 * UPDATE ... RETURNING, so a concurrent loser cannot pass this boundary.
 */
export async function claimPostItemForPublishing(input: ClaimPostItemInput): Promise<boolean> {
  const db = getServiceDb();
  const { data, error } = await db.rpc('claim_post_item', {
    p_workspace_id: input.workspaceId,
    p_post_item_id: input.postItemId,
    p_attempt_id: input.attemptId,
    p_lease_until: input.leaseUntil,
  });

  if (!error) {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length > 1) {
      throw new Error('[publish-post] claim returned more than one winner');
    }
    return rows.length === 1;
  }

  if (!isMissingNamedRpc(error, 'claim_post_item')) {
    throw new Error(`[publish-post] atomic claim failed: ${error.message}`);
  }

  // Schema-drift compatibility only: prove workspace ownership before the
  // legacy conditional write because post_items has no workspace_id column.
  const { data: scopedItem, error: scopeError } = await db
    .from('post_items')
    .select('id, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', input.workspaceId)
    .eq('id', input.postItemId)
    .maybeSingle<{ id: string }>();
  if (scopeError) {
    throw new Error(`[publish-post] legacy claim scope check failed: ${scopeError.message}`);
  }
  if (!scopedItem) return false;

  const { data: claimed, error: legacyError } = await db
    .from('post_items')
    .update({ status: 'publishing' })
    .eq('id', input.postItemId)
    .in('status', ['queued', 'scheduled'])
    .select('id')
    .maybeSingle<{ id: string }>();
  if (legacyError) {
    throw new Error(`[publish-post] legacy claim failed: ${legacyError.message}`);
  }
  return Boolean(claimed);
}

export async function executeClaimedPostItem<T>(
  input: ClaimPostItemInput,
  execute: () => Promise<T>
): Promise<{ claimed: false } | { claimed: true; result: T }> {
  const claimed = await claimPostItemForPublishing(input);
  if (!claimed) return { claimed: false };
  return { claimed: true, result: await execute() };
}

interface ReleasePostItemClaimInput {
  workspaceId: string;
  postItemId: string;
  attemptId: string;
  reason: string;
}

interface ReleasedPostItemClaim {
  status: 'queued' | 'failed';
  retryCount: number | null;
  legacy: boolean;
}

export async function releasePostItemClaimForRetry(
  input: ReleasePostItemClaimInput
): Promise<ReleasedPostItemClaim | null> {
  const db = getServiceDb();
  const { data, error } = await db.rpc('release_post_item_claim_for_retry', {
    p_workspace_id: input.workspaceId,
    p_post_item_id: input.postItemId,
    p_attempt_id: input.attemptId,
    p_reason: input.reason,
  });
  if (error && !isMissingNamedRpc(error, 'release_post_item_claim_for_retry')) {
    throw new Error(`[publish-post] safe retry release failed: ${error.message}`);
  }
  if (!error) {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length > 1) {
      throw new Error('[publish-post] safe retry release returned more than one row');
    }
    const row = rows[0] as
      | { status: 'queued' | 'failed'; retry_count: number }
      | undefined;
    return row
      ? { status: row.status, retryCount: row.retry_count, legacy: false }
      : null;
  }

  // Pre-020 compatibility cannot enforce a durable automatic retry budget.
  // Finish in the legacy `failed` state instead of leaving `publishing`
  // stranded or creating an unbounded chain of fresh events.
  const { data: scopedItem, error: scopeError } = await db
    .from('post_items')
    .select('id, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', input.workspaceId)
    .eq('id', input.postItemId)
    .maybeSingle<{ id: string }>();
  if (scopeError) {
    throw new Error(`[publish-post] legacy safe retry scope check failed: ${scopeError.message}`);
  }
  if (!scopedItem) return null;

  const legacyMessage =
    `Automatic retry paused until Migration 020 is applied: ${input.reason}`.slice(0, 1000);
  const { data: finalized, error: legacyError } = await db
    .from('post_items')
    .update({ status: 'failed', error_message: legacyMessage })
    .eq('id', input.postItemId)
    .eq('status', 'publishing')
    .select('id, status')
    .maybeSingle<{ id: string; status: 'failed' }>();
  if (legacyError) {
    throw new Error(`[publish-post] legacy safe retry finalization failed: ${legacyError.message}`);
  }
  return finalized ? { status: 'failed', retryCount: null, legacy: true } : null;
}

export type PublishRecoveryDecision =
  | { kind: 'retry'; retryAt: string; reason: string }
  | {
      kind: 'finalize';
      status: 'published' | 'failed' | 'reconciliation_required';
      errorMessage: string | null;
    };

export function publishRecoveryDecision(
  attempt: PublishAttemptResult,
  now: Date = new Date()
): PublishRecoveryDecision {
  if (attempt.outcome === 'rate_limited' || attempt.outcome === 'retryable') {
    const fallbackDelay = attempt.outcome === 'rate_limited' ? 15 * 60_000 : 5 * 60_000;
    return {
      kind: 'retry',
      retryAt: attempt.retryAtIso ?? new Date(now.getTime() + fallbackDelay).toISOString(),
      reason:
        attempt.errorMessage ??
        (attempt.outcome === 'rate_limited'
          ? 'Rate limited before publishing.'
          : 'Platform unavailable before publishing.'),
    };
  }
  if (attempt.outcome === 'unknown') {
    return {
      kind: 'finalize',
      status: 'reconciliation_required',
      errorMessage:
        attempt.errorMessage ??
        'Publishing outcome is unknown. Confirm on the platform before retrying.',
    };
  }
  if (attempt.outcome === 'failed') {
    return {
      kind: 'finalize',
      status: 'failed',
      errorMessage: attempt.errorMessage ?? 'Unknown publish error',
    };
  }
  return { kind: 'finalize', status: 'published', errorMessage: null };
}

interface FinalizePostItemClaimInput {
  workspaceId: string;
  postItemId: string;
  attemptId: string;
  status: 'published' | 'failed' | 'reconciliation_required';
  platformPostId: string | null;
  platformUrl: string | null;
  errorMessage: string | null;
  publishedAt: string | null;
}

interface FinalizedPostItemClaim {
  post_item_id: string;
  status: 'published' | 'failed' | 'reconciliation_required';
  platform_post_id: string | null;
}

export async function finalizePostItemClaim(
  input: FinalizePostItemClaimInput
): Promise<FinalizedPostItemClaim> {
  const db = getServiceDb();
  const { data, error } = await db.rpc('finalize_post_item_claim', {
    p_workspace_id: input.workspaceId,
    p_post_item_id: input.postItemId,
    p_attempt_id: input.attemptId,
    p_status: input.status,
    p_platform_post_id: input.platformPostId,
    p_platform_url: input.platformUrl,
    p_error_message: input.errorMessage,
    p_published_at: input.publishedAt,
  });

  if (!error) {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length !== 1) {
      throw new Error('[publish-post] claim fence rejected finalization');
    }
    return rows[0] as FinalizedPostItemClaim;
  }

  if (!isMissingNamedRpc(error, 'finalize_post_item_claim')) {
    throw new Error(`[publish-post] atomic finalization failed: ${error.message}`);
  }

  // Migration-pending compatibility: the one-shot legacy claim never permits
  // automatic takeover, and finalization still requires status=publishing.
  const { data: scopedItem, error: scopeError } = await db
    .from('post_items')
    .select('id, post_groups!inner(workspace_id)')
    .eq('post_groups.workspace_id', input.workspaceId)
    .eq('id', input.postItemId)
    .maybeSingle<{ id: string }>();
  if (scopeError) {
    throw new Error(`[publish-post] legacy finalization scope check failed: ${scopeError.message}`);
  }
  if (!scopedItem) {
    throw new Error('[publish-post] claim fence rejected finalization');
  }

  const legacyReconciliation = input.status === 'reconciliation_required';
  const update =
    input.status === 'published'
      ? {
          status: 'published',
          platform_post_id: input.platformPostId,
          platform_url: input.platformUrl,
          published_at: input.publishedAt,
          error_message: null,
        }
      : {
          status: legacyReconciliation ? 'failed' : input.status,
          platform_post_id: null,
          platform_url: null,
          published_at: null,
          error_message: legacyReconciliation
            ? legacyReconciliationMessage(input.errorMessage)
            : (input.errorMessage ?? 'Unknown publish error'),
        };
  const { data: finalized, error: legacyError } = await db
    .from('post_items')
    .update(update)
    .eq('id', input.postItemId)
    .eq('status', 'publishing')
    .select('id, status, platform_post_id')
    .maybeSingle<{
      id: string;
      status: 'published' | 'failed' | 'reconciliation_required';
      platform_post_id: string | null;
    }>();
  if (legacyError) {
    throw new Error(`[publish-post] legacy finalization failed: ${legacyError.message}`);
  }
  if (!finalized) {
    throw new Error('[publish-post] claim fence rejected finalization');
  }
  return {
    post_item_id: finalized.id,
    status: legacyReconciliation ? 'reconciliation_required' : finalized.status,
    platform_post_id: finalized.platform_post_id,
  };
}

export const publishPost = inngest.createFunction(
  {
    id: 'publish-post',
    retries: 2,
    concurrency: [{ limit: 5, key: 'event.data.workspaceId' }],
  },
  { event: 'post/publish' },
  async ({ event, step }) => {
    if (!(await isAutomationEnabled())) return { published: false, skipped: true, reason: 'automation disabled' };

    const { postItemId, workspaceId } = event.data;

    // 1. Load immutable inputs. The one-shot claim happens inside the same
    // Inngest step callback as the external adapter call below.
    const prepared = await step.run('load-post-item', async () => {
      const db = getServiceDb();
      const { data: item, error } = await db
        .from('post_items')
        .select(`${POST_ITEM_ROW_COLUMNS}, post_groups!inner(workspace_id)`)
        .eq('post_groups.workspace_id', workspaceId)
        .eq('id', postItemId)
        .maybeSingle<PostItemRow & { post_groups: { workspace_id: string } }>();
      if (error) throw new Error(`[publish-post] item load failed: ${error.message}`);
      if (!item) throw new NonRetriableError(`post_item ${postItemId} not found`);

      // Idempotency: a rerun after success must never publish twice.
      if (item.status === 'published' || item.status === 'deleted') {
        return { skip: true as const, reason: `status is ${item.status}` };
      }
      if (item.status === 'failed') {
        return { skip: true as const, reason: 'item already failed — retry endpoint resets it' };
      }

      const { data: group, error: groupError } = await db
        .from('post_groups')
        .select(POST_GROUP_PUBLISH_COLUMNS)
        .eq('workspace_id', workspaceId)
        .eq('id', item.post_group_id)
        .single<PostGroupRow>();
      if (groupError || !group) {
        throw new Error(`[publish-post] group load failed: ${groupError?.message ?? 'missing'}`);
      }
      if (group.workspace_id !== workspaceId) {
        throw new NonRetriableError('workspace mismatch between event and post_group');
      }

      const { data: connection, error: connError } = await db
        .from('platform_connections')
        .select(CONNECTION_ROW_COLUMNS)
        .eq('workspace_id', workspaceId)
        .eq('id', item.connection_id)
        .single<ConnectionRow>();
      if (connError || !connection) {
        throw new Error(`[publish-post] connection load failed: ${connError?.message ?? 'missing'}`);
      }

      // Rate-limit budget from the last API call (Invariante 5): if
      // exhausted, wait for the reset silently — never a user-facing error.
      const state = connection.rate_limit_state ?? {};
      const remaining = typeof state.remaining === 'number' ? state.remaining : null;
      const resetAt = typeof state.reset_at === 'string' ? state.reset_at : null;
      const waitUntil =
        remaining !== null && remaining <= 0 && resetAt && new Date(resetAt).getTime() > Date.now()
          ? resetAt
          : null;

      return {
        skip: false as const,
        item,
        group,
        connection,
        waitUntil,
      };
    });

    if (prepared.skip) {
      return { published: false, skipped: true, reason: prepared.reason };
    }

    if (prepared.waitUntil) {
      await step.sleepUntil('wait-for-rate-limit-budget', new Date(prepared.waitUntil));
    }

    // 2. The claim and adapter execution share one retried step callback.
    // If the callback reruns after an unknown network outcome, the durable
    // claim is already consumed and the adapter is not called a second time.
    const execution = await step.run('publish-to-platform', async () => {
      // Created after every pre-claim sleep, never in the memoized load step.
      const claim = createPostItemClaim(workspaceId, prepared.item.id);
      const claimedExecution = await executeClaimedPostItem(claim, async () => {
        try {
          return await publishAttempt(
            prepared.item,
            prepared.group,
            prepared.connection,
            workspaceId
          );
        } catch (error) {
          return {
            outcome: 'unknown' as const,
            errorMessage:
              error instanceof Error
                ? `Publishing outcome is unknown: ${error.message}`
                : 'Publishing outcome is unknown after an unexpected adapter failure.',
          };
        }
      });
      return { ...claimedExecution, attemptId: claim.attemptId };
    });
    if (!execution.claimed) {
      return {
        published: false,
        skipped: true,
        reason: 'item is already claimed or has an unresolved external publish attempt',
      };
    }
    const attempt = execution.result;
    const recovery = publishRecoveryDecision(attempt);

    if (recovery.kind === 'retry') {
      const released = await step.run('release-safe-retry-claim', () =>
        releasePostItemClaimForRetry({
          workspaceId,
          postItemId: prepared.item.id,
          attemptId: execution.attemptId,
          reason: recovery.reason,
        })
      );
      if (!released) {
        throw new Error('[publish-post] safe retry claim fence was lost');
      }
      if (released.status === 'failed') {
        await step.sendEvent('fire-retry-exhausted-webhook', {
          name: 'webhooks/fire',
          data: {
            workspaceId,
            event: 'post.failed',
            payload: {
              post_group_id: prepared.item.post_group_id,
              post_item_id: prepared.item.id,
              platform: prepared.item.platform,
              error: recovery.reason,
            },
          },
        });
        return {
          published: false,
          error: recovery.reason,
          retryExhausted: true,
        };
      }
      await step.sleepUntil('wait-for-safe-publish-retry', new Date(recovery.retryAt));
      await step.sendEvent('enqueue-safe-publish-retry', {
        name: 'post/publish',
        data: { postItemId: prepared.item.id, workspaceId },
      });
      return {
        published: false,
        deferred: true,
        retryAt: recovery.retryAt,
        reason: recovery.reason,
      };
    }

    // 3. Finalize status (write -> read-back -> verify).
    await step.run('finalize-status', async () => {
      const db = getServiceDb();
      const isPublished = recovery.status === 'published';
      const publishedAt = isPublished ? new Date().toISOString() : null;
      const finalized = await finalizePostItemClaim({
        workspaceId,
        postItemId: prepared.item.id,
        attemptId: execution.attemptId,
        status: recovery.status,
        platformPostId: isPublished ? (attempt.platformPostId ?? null) : null,
        platformUrl: isPublished ? (attempt.platformUrl ?? null) : null,
        errorMessage: recovery.errorMessage,
        publishedAt,
      });
      if (
        finalized.status !== recovery.status ||
        (isPublished && !finalized.platform_post_id)
      ) {
        throw new Error('[publish-post] status verification failed');
      }

      // Persist the platform's rate-limit headers for the next budget check.
      if (attempt.rateLimit) {
        const { error: rlError } = await db
          .from('platform_connections')
          .update({ rate_limit_state: attempt.rateLimit, last_used_at: new Date().toISOString() })
          .eq('workspace_id', workspaceId)
          .eq('id', prepared.connection.id);
        if (rlError) {
          console.error('[publish-post] rate limit state write failed:', rlError.message);
        }
      }
    });

    if (recovery.status === 'reconciliation_required') {
      return { published: false, reconciliationRequired: true, error: recovery.errorMessage };
    }

    if (recovery.status === 'failed') {
      await step.sendEvent('fire-failed-webhook', {
        name: 'webhooks/fire',
        data: {
          workspaceId,
          event: 'post.failed',
          payload: {
            post_group_id: prepared.item.post_group_id,
            post_item_id: prepared.item.id,
            platform: prepared.item.platform,
            error: recovery.errorMessage,
          },
        },
      });
      return { published: false, error: attempt.errorMessage };
    }

    // A separately durable event makes normal and operator-confirmed publishes
    // converge on exactly the same downstream webhook/comment/metrics flow.
    await step.sendEvent('enqueue-published-effects', {
      id: `post-published-effects:${prepared.item.id}`,
      name: 'post/published-effects',
      data: { postItemId: prepared.item.id, workspaceId },
    });

    return { published: true, platformPostId: attempt.platformPostId };
  }
);

export const publishPostEffects = inngest.createFunction(
  {
    id: 'publish-post-effects',
    retries: 3,
  },
  { event: 'post/published-effects' },
  async ({ event, step }) => {
    if (!(await isAutomationEnabled())) return { delivered: false, skipped: true, reason: 'automation disabled' };

    const { postItemId, workspaceId } = event.data;
    const prepared = await step.run('load-published-post', async () => {
      const db = getServiceDb();
      const { data, error } = await db
        .from('post_items')
        .select(
          'id, post_group_id, platform, status, platform_post_id, platform_url, post_groups!inner(workspace_id, first_comment)'
        )
        .eq('post_groups.workspace_id', workspaceId)
        .eq('id', postItemId)
        .maybeSingle<{
          id: string;
          post_group_id: string;
          platform: string;
          status: string;
          platform_post_id: string | null;
          platform_url: string | null;
          post_groups: { workspace_id: string; first_comment: string | null };
        }>();
      if (error) throw new Error(`[publish-effects] item load failed: ${error.message}`);
      if (!data || data.status !== 'published' || !data.platform_post_id) return null;
      return data;
    });

    if (!prepared) return { delivered: false, reason: 'item is not published' };

    await step.sendEvent('fire-published-webhook', {
      name: 'webhooks/fire',
      data: {
        workspaceId,
        event: 'post.published',
        payload: {
          post_group_id: prepared.post_group_id,
          post_item_id: prepared.id,
          platform: prepared.platform,
          platform_post_id: prepared.platform_post_id,
          platform_url: prepared.platform_url,
        },
      },
    });

    if (prepared.post_groups.first_comment) {
      await step.sendEvent('send-first-comment', {
        name: 'post/first-comment',
        data: {
          postItemId,
          workspaceId,
          comment: prepared.post_groups.first_comment,
        },
      });
    }

    await step.sleep('wait-before-first-metrics', '1h');
    await step.sendEvent('collect-first-metrics', {
      name: 'metrics/collect',
      data: { postItemId, workspaceId },
    });

    return { delivered: true };
  }
);

export const reconcileExpiredPublishing = inngest.createFunction(
  {
    id: 'reconcile-expired-publishing',
    retries: 1,
  },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    if (!(await isAutomationEnabled())) return { skipped: true, reason: 'automation disabled' };

    const reconciled = await step.run('mark-expired-publish-claims', () =>
      reconcileExpiredPostItemClaims()
    );
    return { reconciliationRequired: reconciled.length };
  }
);

// One publish attempt. Handles the PlatformError taxonomy:
// AUTH_EXPIRED -> forced token refresh + one retry (same call)
// RATE_LIMITED -> reported to the caller for sleepUntil
// CONTENT_REJECTED -> failed, no retry
// PRECOMMIT_RETRYABLE -> safe fresh-attempt retry
// PLATFORM_DOWN / NETWORK_ERROR -> operator reconciliation (the POST may have committed)
export async function publishAttempt(
  item: PostItemRow,
  group: PostGroupRow,
  connection: ConnectionRow,
  workspaceId: string
): Promise<PublishAttemptResult> {
  await assertAiPostQaFreshForWorkspace({
    workspaceId,
    platform: item.platform,
    resolvedContent: item.resolved_content ?? item.adapted_content ?? group.original_content,
    qaContext: item.qa_context,
  });
  const adapter = createAdapter(connection.platform);

  // Media: storage keys -> per-platform variant -> FRESH signed URLs (R2).
  const media: MediaAttachment[] = [];
  const itemMedia = item.media?.length ? item.media : ((group.media ?? []) as MediaRef[]);
  for (const ref of itemMedia) {
    const preparedMedia =
      ref.type === 'image'
        ? await prepareImageForPlatform(connection.platform, ref)
        : { storageKey: ref.storage_key, mimeType: ref.mime_type };
    media.push({
      storageKey: preparedMedia.storageKey,
      mimeType: preparedMedia.mimeType,
      altText: ref.alt_text,
      signedUrl: await createSignedMediaUrl(preparedMedia.storageKey, 3600),
    });
  }

  const publishOnce = async (): Promise<PublishAttemptResult> => {
    const { token } = await getValidToken(connection.id, workspaceId);
    const result = await adapter.publish(
      {
        content: item.resolved_content ?? item.adapted_content ?? group.original_content,
        media,
        connectionConfig: connection.config ?? {},
        idempotencyKey: item.id,
      },
      token
    );
    return {
      outcome: 'published',
      platformPostId: result.platformPostId,
      platformUrl: result.platformUrl,
      rateLimit: serializeRateLimit(result.rateLimit),
    };
  };

  const classifyPlatformError = (error: PlatformError): PublishAttemptResult => {
    switch (error.type) {
      case 'AUTH_REVOKED':
        return {
          outcome: 'failed',
          errorMessage: `Access revoked — reconnect required (${error.message})`,
        };
      case 'RATE_LIMITED':
        return {
          outcome: 'rate_limited',
          retryAtIso: error.retryAfter?.toISOString(),
          errorMessage: error.message,
        };
      case 'CONTENT_REJECTED':
        return { outcome: 'failed', errorMessage: error.message };
      case 'PRECOMMIT_RETRYABLE':
        return {
          outcome: 'retryable',
          retryAtIso: error.retryAfter?.toISOString(),
          errorMessage: error.message,
        };
      case 'PLATFORM_DOWN':
      case 'NETWORK_ERROR':
        return {
          outcome: 'unknown',
          errorMessage: `Publishing outcome is unknown: ${error.message}`,
        };
      case 'AUTH_EXPIRED':
        return { outcome: 'failed', errorMessage: error.message };
      case 'UNKNOWN':
        return {
          outcome: 'unknown',
          errorMessage: `Publishing outcome is unknown: ${error.message}`,
        };
      default:
        return {
          outcome: 'unknown',
          errorMessage: `Publishing outcome is unknown: ${error.message}`,
        };
    }
  };

  try {
    return await publishOnce();
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;

    if (error.type !== 'AUTH_EXPIRED') {
      return classifyPlatformError(error);
    }

    // Token rejection proves the first request did not publish. A refresh
    // failure is therefore safe to retry from a fresh claim/event.
    try {
      await refreshConnectionToken(connection.id, workspaceId, true);
    } catch (refreshError) {
      return {
        outcome: 'retryable',
        errorMessage:
          refreshError instanceof Error
            ? `Token refresh failed before publishing: ${refreshError.message}`
            : 'Token refresh failed before publishing.',
      };
    }

    try {
      return await publishOnce();
    } catch (retryError) {
      if (retryError instanceof PlatformError) {
        return classifyPlatformError(retryError);
      }
      return {
        outcome: 'unknown',
        errorMessage:
          retryError instanceof Error
            ? `Publishing outcome is unknown after token refresh: ${retryError.message}`
            : 'Publishing outcome is unknown after token refresh.',
      };
    }
  }
}

function serializeRateLimit(
  rateLimit: RateLimitInfo | null | undefined
): { remaining: number; limit: number; reset_at: string } | null {
  if (!rateLimit) return null;
  return {
    remaining: rateLimit.remaining,
    limit: rateLimit.limit,
    reset_at: rateLimit.resetsAt.toISOString(),
  };
}

export const publishScheduled = inngest.createFunction(
  {
    id: 'publish-scheduled',
    retries: 1,
  },
  { cron: '*/5 * * * *' },
  async ({ step }) => {
    if (!(await isAutomationEnabled())) return { skipped: true, reason: 'automation disabled' };

    const due = await step.run('find-due-posts', async () => {
      const db = getServiceDb();
      const nowIso = new Date().toISOString();

      const { data, error } = await db
        .from('post_items')
        .select('id, post_groups!inner(workspace_id, scheduled_at)')
        .eq('status', 'scheduled')
        .lte('post_groups.scheduled_at', nowIso)
        .limit(200)
        .returns<Array<{ id: string; post_groups: { workspace_id: string } }>>();
      if (error) throw new Error(`[publish-scheduled] query failed: ${error.message}`);

      return (data ?? []).map((row) => ({
        postItemId: row.id,
        workspaceId: row.post_groups.workspace_id,
      }));
    });

    if (due.length > 0) {
      await step.sendEvent(
        'fan-out-publish',
        due.map((item) => ({ name: 'post/publish' as const, data: item }))
      );
    }

    return { due: due.length };
  }
);

export const publishFirstComment = inngest.createFunction(
  {
    id: 'publish-first-comment',
    retries: 2,
  },
  { event: 'post/first-comment' },
  async ({ event, step }) => {
    if (!(await isAutomationEnabled())) return { commented: false, skipped: true, reason: 'automation disabled' };

    // Give the platform time to fully materialize the post first.
    await step.sleep('wait-for-platform', '30m');

    return step.run('post-comment', async () => {
      const { postItemId, workspaceId, comment } = event.data;
      const db = getServiceDb();

      const { data: item, error } = await db
        .from('post_items')
        .select(`${POST_ITEM_ROW_COLUMNS}, post_groups!inner(workspace_id)`)
        .eq('post_groups.workspace_id', workspaceId)
        .eq('id', postItemId)
        .maybeSingle<PostItemRow & { post_groups: { workspace_id: string } }>();
      if (error) throw new Error(`[first-comment] item load failed: ${error.message}`);
      if (!item || item.status !== 'published' || !item.platform_post_id) {
        return { commented: false, reason: 'item is not published' };
      }

      const { token, connection } = await getValidToken(item.connection_id, workspaceId);
      const adapter = createAdapter(connection.platform);
      try {
        await adapter.postComment(
          {
            postId: item.platform_post_id,
            content: comment,
            connectionConfig: connection.config ?? {},
          },
          token
        );
      } catch (commentError) {
        if (commentError instanceof PlatformError && !commentError.retryable) {
          // The post itself is live — a dead first comment must not fail it.
          console.error(`[first-comment] unrecoverable for ${postItemId}:`, commentError.message);
          return { commented: false, reason: commentError.message };
        }
        throw commentError;
      }
      return { commented: true };
    });
  }
);
