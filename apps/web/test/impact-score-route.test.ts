// GOAL-RUN8 T1.4 — free checks never cross the LLM boundary; quota errors stay structured.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  scorePost: vi.fn(),
}));

vi.mock('@/lib/api/auth-middleware', () => ({ authenticate: mocks.authenticate }));
vi.mock('@/lib/scoring/score-service', () => ({ scorePost: mocks.scorePost }));

import { POST } from '@/app/api/v1/posts/score/route';
import { ApiError } from '@/lib/api/http';

describe('POST /v1/posts/score', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ workspaceId: 'workspace-1', method: 'session' });
  });

  test('serves deterministic checks in under 200ms without calling the LLM service', async () => {
    const request = new NextRequest('http://localhost/api/v1/posts/score?mode=checks', {
      method: 'POST',
      body: JSON.stringify({ content: 'A short useful post.', platform: 'linkedin' }),
      headers: { 'content-type': 'application/json' },
    });
    const startedAt = performance.now();

    const response = await POST(request);
    const elapsed = performance.now() - startedAt;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(200);
    expect(body).toMatchObject({ formatting_score: 20, platform_hygiene_score: 20 });
    expect(mocks.scorePost).not.toHaveBeenCalled();
  });

  test('passes the existing quota error through instead of returning 500', async () => {
    mocks.scorePost.mockRejectedValue(
      new ApiError(402, 'Monthly AI credit limit reached.', 'quota_exceeded')
    );
    const request = new NextRequest('http://localhost/api/v1/posts/score', {
      method: 'POST',
      body: JSON.stringify({ content: 'A post.', platform: 'linkedin' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ code: 'quota_exceeded' });
  });
});
