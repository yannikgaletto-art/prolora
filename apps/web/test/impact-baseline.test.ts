// GOAL-RUN8 T2.3 — robust engagement calibration on log1p values.
import { describe, expect, test } from 'vitest';
import {
  classifyOutcome,
  computeBaseline,
  engagementScore,
  expectationBand,
} from '@/lib/scoring/baseline';

describe('engagementScore', () => {
  test('weights comments and shares more heavily than likes', () => {
    expect(engagementScore({ likes: 4, comments: 3, shares: 2 })).toBe(16);
    expect(engagementScore({ likes: -2, comments: Number.NaN, shares: 1 })).toBe(3);
  });
});

describe('computeBaseline and classifyOutcome', () => {
  test('keeps empty and three-post histories unclassified', () => {
    expect(computeBaseline([])).toEqual({ n: 0, median: 0, mad: 0 });
    const baseline = computeBaseline([2, 4, 8]);
    expect(classifyOutcome(20, baseline).bucket).toBeNull();
  });

  test('uses ratio buckets when n is below 20 and MAD is zero', () => {
    const baseline = computeBaseline(Array(10).fill(9));
    expect(baseline.mad).toBe(0);
    expect(classifyOutcome(4, baseline)).toMatchObject({ ratio: 0.5, z: null, bucket: 'inline' });
    expect(classifyOutcome(14, baseline)).toMatchObject({ ratio: 1.5, z: null, bucket: 'inline' });
    expect(classifyOutcome(29, baseline)).toMatchObject({ ratio: 3, z: null, bucket: 'above' });
    expect(classifyOutcome(30, baseline)).toMatchObject({ ratio: 3.1, z: null, bucket: 'outlier' });
    expect(classifyOutcome(3, baseline).bucket).toBe('below');
  });

  test('a single 10x outlier does not move the median', () => {
    const baseline = computeBaseline([...Array(29).fill(10), 100]);
    expect(baseline.median).toBeCloseTo(Math.log1p(10), 10);
  });

  test('uses robust z for mature, non-zero-MAD baselines', () => {
    const baseline = computeBaseline(Array.from({ length: 30 }, (_, index) => index + 1));
    const outcome = classifyOutcome(1_000, baseline);
    expect(outcome.z).not.toBeNull();
    expect(outcome.z!).toBeGreaterThanOrEqual(3.5);
    expect(outcome.bucket).toBe('outlier');
  });

  test('shows an honest median ± MAD band only for mature baselines', () => {
    expect(expectationBand(computeBaseline(Array(19).fill(10)))).toBeNull();
    const band = expectationBand(computeBaseline(Array.from({ length: 20 }, (_, index) => index + 1)));
    expect(band).not.toBeNull();
    expect(band!.low).toBeLessThanOrEqual(band!.median);
    expect(band!.high).toBeGreaterThanOrEqual(band!.median);
    expect(band!.n).toBe(20);
  });
});
