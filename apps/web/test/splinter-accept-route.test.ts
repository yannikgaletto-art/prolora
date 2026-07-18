import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getWorkspaceId: vi.fn(),
  nextSlot: vi.fn(),
  createPost: vi.fn(),
  usageInsert: vi.fn(),
}));

vi.mock('@/lib/api/auth-middleware', () => ({ getWorkspaceId: mocks.getWorkspaceId }));
vi.mock('@/lib/posts/posting-schedules', () => ({ nextFreePostingSlot: mocks.nextSlot }));
vi.mock('@/lib/posts/create-post', () => ({ createPost: mocks.createPost }));
vi.mock('@/lib/db', () => ({
  getServiceDb: () => ({
    from: (table: string) => table === 'platform_connections'
      ? {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { platform: 'linkedin' }, error: null }) }),
            }),
          }),
        }
      : { insert: mocks.usageInsert },
  }),
}));

import { POST } from '@/app/api/v1/content/splinters/accept/route';

describe('POST /v1/content/splinters/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceId.mockResolvedValue('workspace');
    mocks.nextSlot.mockResolvedValue({
      slotId: 'slot', instant: '2026-07-24T07:00:00.000Z', timezone: 'Europe/Berlin',
      localDate: '2026-07-24', localTime: '09:00:00',
    });
    mocks.createPost.mockResolvedValue({
      response: { post_group_id: 'group', items: [{ platform: 'linkedin', connection_id: '11111111-1111-4111-8111-111111111111', status: 'draft' }], credits_used: 0 },
      warnings: [],
    });
    mocks.usageInsert.mockResolvedValue({ error: null });
  });

  test('runs free checks and creates a scheduled draft without publishing', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/content/splinters/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connection_id: '11111111-1111-4111-8111-111111111111',
        platform: 'linkedin', content: 'Ein konkreter kurzer Entwurf.',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.checks).toMatchObject({ formatting_score: 20, platform_hygiene_score: 20 });
    expect(mocks.createPost).toHaveBeenCalledWith('workspace', expect.objectContaining({
      draft: true,
      scheduled_at: '2026-07-24T07:00:00.000Z',
      scheduled_tz: 'Europe/Berlin',
    }), 'dashboard');
  });

  test('does not create a draft when no queue slot exists', async () => {
    mocks.nextSlot.mockResolvedValue(null);
    const response = await POST(new NextRequest('http://localhost/api/v1/content/splinters/accept', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connection_id: '11111111-1111-4111-8111-111111111111',
        platform: 'linkedin', content: 'Entwurf',
      }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.createPost).not.toHaveBeenCalled();
  });
});
