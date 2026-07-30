import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PlatformError } from '@/lib/adapters/types';
import type { ConnectionRow, PostGroupRow, PostItemRow } from '@/lib/db';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  getValidToken: vi.fn(),
  refreshConnectionToken: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    createFunction: vi.fn((_options, _trigger, handler) => handler),
  },
}));
vi.mock('@/lib/adapters', () => ({
  createAdapter: () => ({ publish: mocks.publish }),
}));
vi.mock('@/lib/auth/token-manager', () => ({
  getValidToken: mocks.getValidToken,
  refreshConnectionToken: mocks.refreshConnectionToken,
}));
vi.mock('@/lib/media/transform', () => ({
  prepareImageForPlatform: vi.fn(),
  createSignedMediaUrl: vi.fn(),
}));

import { publishAttempt } from '@/lib/inngest/functions/publish-post';

const item = {
  id: 'post-item-1',
  media: [],
  resolved_content: 'Ready to publish',
  adapted_content: null,
} as unknown as PostItemRow;
const group = {
  original_content: 'Original',
  media: [],
} as unknown as PostGroupRow;
const connection = {
  id: 'connection-1',
  platform: 'x',
  config: {},
} as unknown as ConnectionRow;

describe('publish adapter recovery classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getValidToken.mockResolvedValue({ token: { accessToken: 'token' } });
    mocks.refreshConnectionToken.mockResolvedValue(undefined);
  });

  test('classifies a live rate limit as safe to retry from a fresh claim', async () => {
    const retryAfter = new Date('2026-07-30T20:00:00.000Z');
    mocks.publish.mockRejectedValue(
      new PlatformError('RATE_LIMITED', 'x', 'slow down', true, retryAfter)
    );

    await expect(
      publishAttempt(item, group, connection, 'workspace-1')
    ).resolves.toMatchObject({
      outcome: 'rate_limited',
      retryAtIso: retryAfter.toISOString(),
    });
  });

  test.each(['NETWORK_ERROR', 'UNKNOWN'] as const)(
    'classifies %s as ambiguous and never auto-retryable',
    async (type) => {
      mocks.publish.mockRejectedValue(new PlatformError(type, 'x', 'request outcome unclear'));

      await expect(
        publishAttempt(item, group, connection, 'workspace-1')
      ).resolves.toMatchObject({
        outcome: 'unknown',
        errorMessage: expect.stringContaining('unknown'),
      });
    }
  );

  test('treats a generic platform 5xx as ambiguous because the POST may have committed', async () => {
    mocks.publish.mockRejectedValue(
      new PlatformError('PLATFORM_DOWN', 'x', 'platform returned 500', true)
    );

    await expect(
      publishAttempt(item, group, connection, 'workspace-1')
    ).resolves.toMatchObject({
      outcome: 'unknown',
      errorMessage: expect.stringContaining('unknown'),
    });
  });

  test('retries only an adapter error explicitly classified as pre-commit safe', async () => {
    mocks.publish.mockRejectedValue(
      new PlatformError(
        'PRECOMMIT_RETRYABLE' as never,
        'x',
        'media processing unavailable before post creation',
        true
      )
    );

    await expect(
      publishAttempt(item, group, connection, 'workspace-1')
    ).resolves.toMatchObject({
      outcome: 'retryable',
    });
  });

  test('preserves ambiguity when the one post-refresh attempt loses its response', async () => {
    mocks.publish
      .mockRejectedValueOnce(new PlatformError('AUTH_EXPIRED', 'x', 'expired'))
      .mockRejectedValueOnce(new PlatformError('NETWORK_ERROR', 'x', 'connection reset'));

    await expect(
      publishAttempt(item, group, connection, 'workspace-1')
    ).resolves.toMatchObject({ outcome: 'unknown' });
    expect(mocks.refreshConnectionToken).toHaveBeenCalledOnce();
    expect(mocks.publish).toHaveBeenCalledTimes(2);
  });
});
