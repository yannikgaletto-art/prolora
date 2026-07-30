import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getWorkspaceId: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/lib/api/auth-middleware', () => ({ getWorkspaceId: mocks.getWorkspaceId }));
vi.mock('@/lib/db', () => ({
  getServiceDb: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: mocks.send },
}));

import { POST } from '@/app/api/v1/posts/items/[id]/reconcile/route';

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/posts/items/item-1/reconcile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/posts/items/:id/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceId.mockResolvedValue('workspace-authenticated');
    mocks.rpc.mockResolvedValue({
      data: [{ post_item_id: 'item-1', status: 'queued', platform_post_id: null }],
      error: null,
    });
    mocks.send.mockResolvedValue(undefined);
  });

  test('queues a fresh publish event only after an operator confirms no post exists', async () => {
    const response = await POST(request({ resolution: 'not_published' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_post_item_reconciliation', {
      p_workspace_id: 'workspace-authenticated',
      p_post_item_id: 'item-1',
      p_resolution: 'not_published',
      p_platform_post_id: null,
      p_platform_url: null,
    });
    expect(mocks.send).toHaveBeenCalledWith({
      name: 'post/publish',
      data: { postItemId: 'item-1', workspaceId: 'workspace-authenticated' },
    });
    await expect(response.json()).resolves.toEqual({
      post_item_id: 'item-1',
      status: 'queued',
      platform_post_id: null,
    });
  });

  test('records a confirmed external post without sending another publish request', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          post_item_id: 'item-1',
          status: 'published',
          platform_post_id: 'external-123',
        },
      ],
      error: null,
    });

    const response = await POST(
      request({
        resolution: 'published',
        platform_post_id: 'external-123',
        platform_url: 'https://social.example/posts/external-123',
      }),
      { params: Promise.resolve({ id: 'item-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_post_item_reconciliation', {
      p_workspace_id: 'workspace-authenticated',
      p_post_item_id: 'item-1',
      p_resolution: 'published',
      p_platform_post_id: 'external-123',
      p_platform_url: 'https://social.example/posts/external-123',
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test('rejects a published resolution without the platform post id', async () => {
    const response = await POST(request({ resolution: 'published' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test('returns a conflict when the item is not awaiting reconciliation', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await POST(request({ resolution: 'not_published' }), {
      params: Promise.resolve({ id: 'item-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
