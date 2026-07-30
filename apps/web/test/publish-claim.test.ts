import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

function queryChain<T>(data: T, error: { code?: string; message: string } | null = null) {
  const result = Promise.resolve({ data, error });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['update', 'eq', 'in', 'select', 'maybeSingle']) {
    chain[method] = vi.fn(() => Object.assign(result, chain));
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({
      rpc: mocks.rpc,
      from: mocks.from,
    }),
  };
});

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_options, _trigger, handler) => handler),
  },
}));

import {
  claimPostItemForPublishing,
  createPostItemClaim,
  executeClaimedPostItem,
  finalizePostItemClaim,
  publishRecoveryDecision,
  releasePostItemClaimForRetry,
} from '@/lib/inngest/functions/publish-post';

describe('atomic post item claim', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
  });

  test('passes workspace, attempt and lease to the RPC and recognizes the sole winner', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          post_item_id: 'post-1',
          claim_attempt_id: '11111111-1111-4111-8111-111111111111',
          claim_lease_until: '2026-07-30T14:00:00.000Z',
        },
      ],
      error: null,
    });

    await expect(
      claimPostItemForPublishing({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '11111111-1111-4111-8111-111111111111',
        leaseUntil: '2026-07-30T14:00:00.000Z',
      })
    ).resolves.toBe(true);

    expect(mocks.rpc).toHaveBeenCalledWith('claim_post_item', {
      p_workspace_id: 'workspace-1',
      p_post_item_id: 'post-1',
      p_attempt_id: '11111111-1111-4111-8111-111111111111',
      p_lease_until: '2026-07-30T14:00:00.000Z',
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  test('returns false for the concurrent loser instead of allowing an adapter call', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      claimPostItemForPublishing({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '22222222-2222-4222-8222-222222222222',
        leaseUntil: '2026-07-30T14:00:00.000Z',
      })
    ).resolves.toBe(false);
  });

  test('does not let the same attempt win a second time', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          {
            post_item_id: 'post-1',
            claim_attempt_id: '22222222-2222-4222-8222-222222222222',
            claim_lease_until: '2026-07-30T14:00:00.000Z',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });

    const input = {
      workspaceId: 'workspace-1',
      postItemId: 'post-1',
      attemptId: '22222222-2222-4222-8222-222222222222',
      leaseUntil: '2026-07-30T14:00:00.000Z',
    };
    await expect(claimPostItemForPublishing(input)).resolves.toBe(true);
    await expect(claimPostItemForPublishing(input)).resolves.toBe(false);
  });

  test('executes the external adapter at most once when the same step retries', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          {
            post_item_id: 'post-1',
            claim_attempt_id: '99999999-9999-4999-8999-999999999999',
            claim_lease_until: '2026-07-30T14:00:00.000Z',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    const adapterCall = vi.fn().mockResolvedValue({ platformPostId: 'platform-1' });
    const input = {
      workspaceId: 'workspace-1',
      postItemId: 'post-1',
      attemptId: '99999999-9999-4999-8999-999999999999',
      leaseUntil: '2026-07-30T14:00:00.000Z',
    };

    await expect(executeClaimedPostItem(input, adapterCall)).resolves.toEqual({
      claimed: true,
      result: { platformPostId: 'platform-1' },
    });
    await expect(executeClaimedPostItem(input, adapterCall)).resolves.toEqual({
      claimed: false,
    });
    expect(adapterCall).toHaveBeenCalledOnce();
  });

  test('does not repeat an adapter after an unknown external outcome', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          {
            post_item_id: 'post-1',
            claim_attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            claim_lease_until: '2026-07-30T14:00:00.000Z',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    const networkOutcomeUnknown = vi.fn().mockRejectedValue(new Error('connection reset'));
    const input = {
      workspaceId: 'workspace-1',
      postItemId: 'post-1',
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leaseUntil: '2026-07-30T14:00:00.000Z',
    };

    await expect(executeClaimedPostItem(input, networkOutcomeUnknown)).rejects.toThrow(
      /connection reset/
    );
    await expect(executeClaimedPostItem(input, networkOutcomeUnknown)).resolves.toEqual({
      claimed: false,
    });
    expect(networkOutcomeUnknown).toHaveBeenCalledOnce();
  });

  test('allows only one of two concurrent attempts to reach an adapter', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          {
            post_item_id: 'post-1',
            claim_attempt_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            claim_lease_until: '2026-07-30T14:00:00.000Z',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null });
    const winningAdapter = vi.fn().mockResolvedValue('published');
    const losingAdapter = vi.fn().mockResolvedValue('must not run');

    const [first, second] = await Promise.all([
      executeClaimedPostItem(
        {
          workspaceId: 'workspace-1',
          postItemId: 'post-1',
          attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          leaseUntil: '2026-07-30T14:00:00.000Z',
        },
        winningAdapter
      ),
      executeClaimedPostItem(
        {
          workspaceId: 'workspace-1',
          postItemId: 'post-1',
          attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          leaseUntil: '2026-07-30T14:00:00.000Z',
        },
        losingAdapter
      ),
    ]);

    expect(first).toEqual({ claimed: true, result: 'published' });
    expect(second).toEqual({ claimed: false });
    expect(winningAdapter).toHaveBeenCalledOnce();
    expect(losingAdapter).not.toHaveBeenCalled();
  });

  test('does not treat an expired lease as an automatic takeover right', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      claimPostItemForPublishing({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '55555555-5555-4555-8555-555555555555',
        leaseUntil: '2026-07-31T14:00:00.000Z',
      })
    ).resolves.toBe(false);
  });

  test('discovers expired claims through one atomic reconciliation RPC', async () => {
    const publishModule = await import('@/lib/inngest/functions/publish-post');
    const reconcileExpiredPostItemClaims = (
      publishModule as typeof publishModule & {
        reconcileExpiredPostItemClaims?: (
          now: Date,
          limit: number
        ) => Promise<Array<{ postItemId: string; workspaceId: string }>>;
      }
    ).reconcileExpiredPostItemClaims;

    expect(reconcileExpiredPostItemClaims).toBeTypeOf('function');
    if (!reconcileExpiredPostItemClaims) return;

    mocks.rpc.mockResolvedValue({
      data: [{ post_item_id: 'post-1', workspace_id: 'workspace-1' }],
      error: null,
    });

    await expect(
      reconcileExpiredPostItemClaims(new Date('2026-08-01T12:00:00.000Z'), 25)
    ).resolves.toEqual([{ postItemId: 'post-1', workspaceId: 'workspace-1' }]);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'reconcile_expired_post_item_claims',
      {
        p_now: '2026-08-01T12:00:00.000Z',
        p_limit: 25,
      }
    );
  });

  test('computes the claim lease at execution time after a long rate-limit sleep', () => {
    const beforeSleep = new Date('2026-07-30T10:00:00.000Z');
    const afterSleep = new Date('2026-07-31T18:00:00.000Z');

    const claim = createPostItemClaim('workspace-1', 'post-1', afterSleep);

    expect(new Date(claim.leaseUntil).getTime()).toBe(
      afterSleep.getTime() + 24 * 60 * 60 * 1000
    );
    expect(new Date(claim.leaseUntil).getTime()).toBeGreaterThan(
      beforeSleep.getTime() + 24 * 60 * 60 * 1000
    );
  });

  test('turns rate limits into a safe fresh-attempt retry decision', () => {
    expect(
      publishRecoveryDecision(
        {
          outcome: 'rate_limited',
          errorMessage: 'slow down',
          retryAtIso: '2026-07-30T15:30:00.000Z',
        },
        new Date('2026-07-30T15:00:00.000Z')
      )
    ).toEqual({
      kind: 'retry',
      retryAt: '2026-07-30T15:30:00.000Z',
      reason: 'slow down',
    });
  });

  test('turns ambiguous network outcomes into visible reconciliation', () => {
    expect(
      publishRecoveryDecision(
        {
          outcome: 'unknown',
          errorMessage: 'Network connection dropped after request dispatch.',
        },
        new Date('2026-07-30T15:00:00.000Z')
      )
    ).toEqual({
      kind: 'finalize',
      status: 'reconciliation_required',
      errorMessage: 'Network connection dropped after request dispatch.',
    });
  });

  test('releases a known-safe failure for a fresh fenced event', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ post_item_id: 'post-1', status: 'queued', retry_count: 1 }],
      error: null,
    });

    await expect(
      releasePostItemClaimForRetry({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        reason: 'Rate limited before publishing.',
      })
    ).resolves.toEqual({ status: 'queued', retryCount: 1, legacy: false });
    expect(mocks.rpc).toHaveBeenCalledWith('release_post_item_claim_for_retry', {
      p_workspace_id: 'workspace-1',
      p_post_item_id: 'post-1',
      p_attempt_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      p_reason: 'Rate limited before publishing.',
    });
  });

  test('returns a terminal failed state when the durable fresh-retry budget is exhausted', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ post_item_id: 'post-1', status: 'failed', retry_count: 3 }],
      error: null,
    });

    await expect(
      releasePostItemClaimForRetry({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        reason: 'Platform unavailable before publishing.',
      })
    ).resolves.toEqual({ status: 'failed', retryCount: 3, legacy: false });
  });

  test('uses a pre-020-valid failed state when the safe-release RPC is missing', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.release_post_item_claim_for_retry',
      },
    });
    const scoped = queryChain({ id: 'post-1' });
    const finalized = queryChain({ id: 'post-1', status: 'failed' as const });
    mocks.from.mockReturnValueOnce(scoped).mockReturnValueOnce(finalized);

    await expect(
      releasePostItemClaimForRetry({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        reason: 'Rate limited before publishing.',
      })
    ).resolves.toEqual({ status: 'failed', retryCount: null, legacy: true });
    expect(finalized.update).toHaveBeenCalledWith({
      status: 'failed',
      error_message: expect.stringContaining('Migration 020'),
    });
  });

  test('uses a returning conditional update only when the claim RPC is missing', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.claim_post_item' },
    });

    const result = Promise.resolve({ data: { id: 'post-1' }, error: null });
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['update', 'eq', 'in', 'select', 'maybeSingle']) {
      chain[method] = vi.fn(() => Object.assign(result, chain));
    }
    mocks.from.mockReturnValue(chain);

    await expect(
      claimPostItemForPublishing({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '33333333-3333-4333-8333-333333333333',
        leaseUntil: '2026-07-30T14:00:00.000Z',
      })
    ).resolves.toBe(true);

    expect(mocks.from).toHaveBeenCalledWith('post_items');
    expect(chain.select).toHaveBeenCalledWith('id');
    expect(chain.maybeSingle).toHaveBeenCalledTimes(2);
  });

  test('does not hide non-schema RPC failures behind the legacy path', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    await expect(
      claimPostItemForPublishing({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '44444444-4444-4444-8444-444444444444',
        leaseUntil: '2026-07-30T14:00:00.000Z',
      })
    ).rejects.toThrow(/permission denied/);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  test('does not treat a bare 42883 for another function as a missing claim RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function public.some_other_function() does not exist' },
    });

    await expect(
      claimPostItemForPublishing({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '66666666-6666-4666-8666-666666666666',
        leaseUntil: '2026-07-31T14:00:00.000Z',
      })
    ).rejects.toThrow(/some_other_function/);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  test('finalizes only through the attempt-fenced RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ post_item_id: 'post-1', status: 'published', platform_post_id: 'platform-1' }],
      error: null,
    });

    await expect(
      finalizePostItemClaim({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '77777777-7777-4777-8777-777777777777',
        status: 'published',
        platformPostId: 'platform-1',
        platformUrl: 'https://example.test/posts/platform-1',
        errorMessage: null,
        publishedAt: '2026-07-30T15:00:00.000Z',
      })
    ).resolves.toEqual({
      post_item_id: 'post-1',
      status: 'published',
      platform_post_id: 'platform-1',
    });

    expect(mocks.rpc).toHaveBeenCalledWith('finalize_post_item_claim', {
      p_workspace_id: 'workspace-1',
      p_post_item_id: 'post-1',
      p_attempt_id: '77777777-7777-4777-8777-777777777777',
      p_status: 'published',
      p_platform_post_id: 'platform-1',
      p_platform_url: 'https://example.test/posts/platform-1',
      p_error_message: null,
      p_published_at: '2026-07-30T15:00:00.000Z',
    });
  });

  test('rejects stale finalization after another attempt owns the fence', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await expect(
      finalizePostItemClaim({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: '88888888-8888-4888-8888-888888888888',
        status: 'failed',
        platformPostId: null,
        platformUrl: null,
        errorMessage: 'platform rejected the post',
        publishedAt: null,
      })
    ).rejects.toThrow(/claim fence/i);
  });

  test('persists an ambiguous outcome as reconciliation_required', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          post_item_id: 'post-1',
          status: 'reconciliation_required',
          platform_post_id: null,
        },
      ],
      error: null,
    });

    await expect(
      finalizePostItemClaim({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: 'reconciliation_required',
        platformPostId: null,
        platformUrl: null,
        errorMessage:
          'Publishing outcome is unknown. Confirm on the platform before retrying.',
        publishedAt: null,
      })
    ).resolves.toMatchObject({ status: 'reconciliation_required' });
  });

  test('uses a marked legacy failed row for ambiguous outcomes before migration 020', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.finalize_post_item_claim',
      },
    });
    const scoped = queryChain({ id: 'post-1' });
    const finalized = queryChain({
      id: 'post-1',
      status: 'failed' as const,
      platform_post_id: null,
    });
    mocks.from.mockReturnValueOnce(scoped).mockReturnValueOnce(finalized);

    await expect(
      finalizePostItemClaim({
        workspaceId: 'workspace-1',
        postItemId: 'post-1',
        attemptId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        status: 'reconciliation_required',
        platformPostId: null,
        platformUrl: null,
        errorMessage: 'Publishing outcome is unknown.',
        publishedAt: null,
      })
    ).resolves.toMatchObject({ status: 'reconciliation_required' });
    expect(finalized.update).toHaveBeenCalledWith({
      status: 'failed',
      platform_post_id: null,
      platform_url: null,
      published_at: null,
      error_message: expect.stringContaining('[reconciliation_required]'),
    });
  });
});
