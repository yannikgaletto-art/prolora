import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getWorkspaceId: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
}));

function queryChain<T>(
  data: T,
  error: { code?: string; message: string } | null = null
) {
  const result = Promise.resolve({ data, error });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['select', 'update', 'eq', 'in', 'returns', 'maybeSingle']) {
    chain[method] = vi.fn(() => Object.assign(result, chain));
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/api/auth-middleware', () => ({ getWorkspaceId: mocks.getWorkspaceId }));
vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({ from: mocks.from }),
  };
});
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: mocks.send } }));

import { POST } from '@/app/api/v1/posts/[id]/retry/route';

const request = new NextRequest('http://localhost/api/v1/posts/group-1/retry', {
  method: 'POST',
});
const context = { params: Promise.resolve({ id: 'group-1' }) };

describe('POST /v1/posts/:id/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceId.mockResolvedValue('workspace-1');
    mocks.send.mockResolvedValue(undefined);
  });

  test('refuses to turn a legacy ambiguous result into another publish attempt', async () => {
    mocks.from
      .mockReturnValueOnce(queryChain({ id: 'group-1' }))
      .mockReturnValueOnce(
        queryChain([
          {
            id: 'item-1',
            status: 'failed',
            error_message: '[reconciliation_required] timeout after request',
          },
        ])
      );

    const response = await POST(request, context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'reconciliation_required' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  test('resets the durable retry budget and falls back safely while migration 020 is pending', async () => {
    const modernUpdate = queryChain(null, {
      code: 'PGRST204',
      message: 'publish_retry_count column missing',
    });
    const legacyUpdate = queryChain(null);
    mocks.from
      .mockReturnValueOnce(queryChain({ id: 'group-1' }))
      .mockReturnValueOnce(
        queryChain([{ id: 'item-1', status: 'failed', error_message: 'adapter rejected content' }])
      )
      .mockReturnValueOnce(modernUpdate)
      .mockReturnValueOnce(legacyUpdate)
      .mockReturnValueOnce(queryChain([{ id: 'item-1', status: 'queued' }]));

    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(modernUpdate.update).toHaveBeenCalledWith({
      status: 'queued',
      error_message: null,
      publish_retry_count: 0,
    });
    expect(legacyUpdate.update).toHaveBeenCalledWith({
      status: 'queued',
      error_message: null,
    });
    expect(mocks.send).toHaveBeenCalledWith([
      {
        name: 'post/publish',
        data: { postItemId: 'item-1', workspaceId: 'workspace-1' },
      },
    ]);
  });
});
