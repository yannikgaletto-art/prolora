import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getWorkspaceId: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/api/auth-middleware', () => ({ getWorkspaceId: mocks.getWorkspaceId }));
vi.mock('@/lib/db', () => ({
  getServiceDb: () => ({
    from: () => ({
      upsert: (...args: unknown[]) => {
        mocks.upsert(...args);
        return {
          select: () => ({
            single: async () => ({ data: { creator_style: 'koe_pia' }, error: null }),
          }),
        };
      },
    }),
  }),
}));

import { PATCH } from '@/app/api/v1/workspace/creator-style/route';

describe('PATCH /v1/workspace/creator-style', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceId.mockResolvedValue('workspace-authenticated');
  });

  test('scopes the upsert to the authenticated workspace', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/v1/workspace/creator-style', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creator_style: 'koe_pia', workspace_id: 'workspace-attacker' }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      { workspace_id: 'workspace-authenticated', creator_style: 'koe_pia' },
      { onConflict: 'workspace_id' }
    );
  });

  test('rejects unknown mechanisms before writing', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/v1/workspace/creator-style', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ creator_style: 'copy_a_person' }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
