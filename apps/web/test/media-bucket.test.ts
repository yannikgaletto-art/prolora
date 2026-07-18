import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createBucket: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getServiceDb: () => ({
    storage: { createBucket: mocks.createBucket },
  }),
}));

import { ensureMediaBucket, MEDIA_BUCKET } from '@/lib/media/transform';

describe('ensureMediaBucket', () => {
  beforeEach(() => {
    mocks.createBucket.mockReset();
    mocks.createBucket.mockResolvedValue({ error: null });
  });

  it('creates the private media bucket once before producers upload', async () => {
    await ensureMediaBucket();
    await ensureMediaBucket();

    expect(mocks.createBucket).toHaveBeenCalledTimes(1);
    expect(mocks.createBucket).toHaveBeenCalledWith(MEDIA_BUCKET, { public: false });
  });
});
