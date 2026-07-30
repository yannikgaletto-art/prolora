import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

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

import { claimPostItemForPublishing } from '@/lib/inngest/functions/publish-post';

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
});
