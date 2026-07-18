import { describe, expect, it } from 'vitest';
import { normalizeMediaFormat, shouldPollGeneration } from '../app/(dashboard)/publish/media-card-logic';

describe('media card logic', () => {
  it('moves square video requests to a supported format', () => {
    expect(normalizeMediaFormat('video', 'square')).toBe('portrait');
    expect(normalizeMediaFormat('image', 'square')).toBe('square');
  });

  it('only polls pending and running generations', () => {
    expect(shouldPollGeneration('pending')).toBe(true);
    expect(shouldPollGeneration('running')).toBe(true);
    expect(shouldPollGeneration('succeeded')).toBe(false);
    expect(shouldPollGeneration('failed')).toBe(false);
  });
});
