import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { getServiceDb, type ConnectionRow, type PostGroupRow, type PostItemRow, type MediaRef } from '@/lib/db';
import { getValidToken, refreshConnectionToken } from '@/lib/auth/token-manager';
import { createAdapter } from '@/lib/adapters';
import { PlatformError, type MediaAttachment, type RateLimitInfo } from '@/lib/adapters/types';
import { prepareImageForPlatform, createSignedMediaUrl } from '@/lib/media/transform';

interface PublishAttemptResult {
  outcome: 'published' | 'rate_limited' | 'failed';
  platformPostId?: string;
  platformUrl?: string;
  errorMessage?: string;
  retryAtIso?: string;
  rateLimit?: { remaining: number; limit: number; reset_at: string } | null;
}

export const publishPost = inngest.createFunction(
  {
    id: 'publish-post',
    retries: 2,
    concurrency: [{ limit: 5, key: 'event.data.workspaceId' }],
  },
  { event: 'post/publish' },
  async ({ event, step }) => {
    const { postItemId, workspaceId } = event.data;

    // 1. Load + claim: queued/scheduled -> publishing (monotone transition).
    const prepared = await step.run('load-post-item', async () => {
      const db = getServiceDb();
      const { data: item, error } = await db
        .from('post_items')
        .select('*')
        .eq('id', postItemId)
        .maybeSingle<PostItemRow>();
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
        .select('*')
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
        .select('*')
        .eq('id', item.connection_id)
        .single<ConnectionRow>();
      if (connError || !connection) {
        throw new Error(`[publish-post] connection load failed: ${connError?.message ?? 'missing'}`);
      }

      // Claim: status -> publishing + read-back (Double Assurance).
      const { error: claimError } = await db
        .from('post_items')
        .update({ status: 'publishing' })
        .eq('id', item.id)
        .in('status', ['queued', 'scheduled']);
      if (claimError) throw new Error(`[publish-post] claim failed: ${claimError.message}`);

      const { data: claimed, error: verifyError } = await db
        .from('post_items')
        .select('status')
        .eq('id', item.id)
        .single<{ status: string }>();
      if (verifyError || claimed?.status !== 'publishing') {
        throw new Error('[publish-post] claim verification failed');
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

    // 2. Publish (attempt 1, with in-step AUTH_EXPIRED refresh+retry).
    let attempt = await step.run('publish-to-platform', () =>
      publishAttempt(prepared.item, prepared.group, prepared.connection)
    );

    // RATE_LIMITED from the platform: sleep until reset, then ONE more try.
    if (attempt.outcome === 'rate_limited') {
      const retryAt = attempt.retryAtIso
        ? new Date(attempt.retryAtIso)
        : new Date(Date.now() + 15 * 60 * 1000);
      await step.sleepUntil('wait-for-rate-limit-reset', retryAt);
      attempt = await step.run('publish-after-rate-limit', () =>
        publishAttempt(prepared.item, prepared.group, prepared.connection)
      );
      if (attempt.outcome === 'rate_limited') {
        attempt = {
          outcome: 'failed',
          errorMessage: 'Rate limit still exhausted after waiting for reset',
        };
      }
    }

    // 3. Finalize status (write -> read-back -> verify).
    await step.run('finalize-status', async () => {
      const db = getServiceDb();
      const isPublished = attempt.outcome === 'published';
      const update: Record<string, unknown> = isPublished
        ? {
            status: 'published',
            platform_post_id: attempt.platformPostId,
            platform_url: attempt.platformUrl,
            published_at: new Date().toISOString(),
            error_message: null,
          }
        : {
            status: 'failed',
            error_message: attempt.errorMessage ?? 'Unknown publish error',
          };

      const { error } = await db.from('post_items').update(update).eq('id', prepared.item.id);
      if (error) throw new Error(`[publish-post] status write failed: ${error.message}`);

      const { data: verify, error: verifyError } = await db
        .from('post_items')
        .select('status, platform_post_id')
        .eq('id', prepared.item.id)
        .single<{ status: string; platform_post_id: string | null }>();
      if (
        verifyError ||
        verify?.status !== (isPublished ? 'published' : 'failed') ||
        (isPublished && !verify.platform_post_id)
      ) {
        throw new Error('[publish-post] status verification failed');
      }

      // Persist the platform's rate-limit headers for the next budget check.
      if (attempt.rateLimit) {
        const { error: rlError } = await db
          .from('platform_connections')
          .update({ rate_limit_state: attempt.rateLimit, last_used_at: new Date().toISOString() })
          .eq('id', prepared.connection.id);
        if (rlError) {
          console.error('[publish-post] rate limit state write failed:', rlError.message);
        }
      }
    });

    // 4. Webhook event — after the status is durable, never blocking it.
    await step.sendEvent('fire-webhook', {
      name: 'webhooks/fire',
      data: {
        workspaceId,
        event: attempt.outcome === 'published' ? 'post.published' : 'post.failed',
        payload: {
          post_group_id: prepared.item.post_group_id,
          post_item_id: prepared.item.id,
          platform: prepared.item.platform,
          ...(attempt.outcome === 'published'
            ? { platform_post_id: attempt.platformPostId, platform_url: attempt.platformUrl }
            : { error: attempt.errorMessage }),
        },
      },
    });

    if (attempt.outcome !== 'published') {
      return { published: false, error: attempt.errorMessage };
    }

    // 5. First comment (own function sleeps before posting).
    if (prepared.group.first_comment) {
      await step.sendEvent('send-first-comment', {
        name: 'post/first-comment',
        data: { postItemId: prepared.item.id, comment: prepared.group.first_comment },
      });
    }

    // 6. First metrics snapshot after 1h (the 4h cron covers later ones).
    await step.sleep('wait-before-first-metrics', '1h');
    await step.sendEvent('collect-first-metrics', {
      name: 'metrics/collect',
      data: { postItemId: prepared.item.id },
    });

    return { published: true, platformPostId: attempt.platformPostId };
  }
);

// One publish attempt. Handles the PlatformError taxonomy:
// AUTH_EXPIRED -> forced token refresh + one retry (same call)
// RATE_LIMITED -> reported to the caller for sleepUntil
// CONTENT_REJECTED -> failed, no retry
// PLATFORM_DOWN / NETWORK_ERROR -> thrown (Inngest retry)
async function publishAttempt(
  item: PostItemRow,
  group: PostGroupRow,
  connection: ConnectionRow
): Promise<PublishAttemptResult> {
  const adapter = createAdapter(connection.platform);

  // Media: storage keys -> per-platform variant -> FRESH signed URLs (R2).
  const media: MediaAttachment[] = [];
  for (const ref of (group.media ?? []) as MediaRef[]) {
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
    const { token } = await getValidToken(connection.id);
    const result = await adapter.publish(
      {
        content: item.adapted_content ?? group.original_content,
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

  try {
    return await publishOnce();
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;

    switch (error.type) {
      case 'AUTH_EXPIRED': {
        // Token died mid-flight: force refresh (advisory-locked), retry once.
        try {
          await refreshConnectionToken(connection.id, true);
          return await publishOnce();
        } catch (retryError) {
          const message =
            retryError instanceof PlatformError ? retryError.message : 'Publish failed after token refresh';
          return { outcome: 'failed', errorMessage: message };
        }
      }
      case 'AUTH_REVOKED':
        return { outcome: 'failed', errorMessage: `Access revoked — reconnect required (${error.message})` };
      case 'RATE_LIMITED':
        return {
          outcome: 'rate_limited',
          retryAtIso: error.retryAfter?.toISOString(),
          errorMessage: error.message,
        };
      case 'CONTENT_REJECTED':
        return { outcome: 'failed', errorMessage: error.message };
      case 'PLATFORM_DOWN':
      case 'NETWORK_ERROR':
        throw error; // transient -> Inngest exponential retry
      default:
        return { outcome: 'failed', errorMessage: error.message };
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
    // Give the platform time to fully materialize the post first.
    await step.sleep('wait-for-platform', '30s');

    return step.run('post-comment', async () => {
      const { postItemId, comment } = event.data;
      const db = getServiceDb();

      const { data: item, error } = await db
        .from('post_items')
        .select('*')
        .eq('id', postItemId)
        .maybeSingle<PostItemRow>();
      if (error) throw new Error(`[first-comment] item load failed: ${error.message}`);
      if (!item || item.status !== 'published' || !item.platform_post_id) {
        return { commented: false, reason: 'item is not published' };
      }

      const { token, connection } = await getValidToken(item.connection_id);
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
