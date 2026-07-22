import { describe, expect, it } from 'vitest';
import {
  GENERATION_STALL_PENDING_MS,
  generationProgress,
  isGenerationStalled,
  normalizeMediaFormat,
  shouldPollGeneration,
} from '../app/(dashboard)/publish/media-card-logic';

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

describe('generationProgress', () => {
  it('never reaches 100% while still polling, and grows monotonically', () => {
    let previous = -1;
    for (const elapsed of [0, 5_000, 30_000, 60_000, 300_000, 3_600_000]) {
      const value = generationProgress('running', elapsed, 'image');
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(90);
      previous = value;
    }
  });

  it('completes only on terminal states', () => {
    expect(generationProgress('succeeded', 1_000, 'image')).toBe(100);
    expect(generationProgress('failed', 1_000, 'video')).toBe(100);
    expect(generationProgress('pending', 3_600_000, 'video')).toBeLessThanOrEqual(90);
  });

  it('shows running ahead of pending and videos slower than images', () => {
    expect(generationProgress('running', 10_000, 'image')).toBeGreaterThan(
      generationProgress('pending', 10_000, 'image')
    );
    expect(generationProgress('running', 30_000, 'image')).toBeGreaterThan(
      generationProgress('running', 30_000, 'video')
    );
  });
});

describe('isGenerationStalled', () => {
  it('flags only long-pending generations — running means the worker is alive', () => {
    expect(isGenerationStalled('pending', GENERATION_STALL_PENDING_MS)).toBe(true);
    expect(isGenerationStalled('pending', GENERATION_STALL_PENDING_MS - 1)).toBe(false);
    expect(isGenerationStalled('running', GENERATION_STALL_PENDING_MS * 10)).toBe(false);
  });
});
