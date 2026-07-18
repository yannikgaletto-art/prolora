// GOAL-RUN8 T2.5 — accuracy is an explicit traffic-light × outcome matrix.
import { describe, expect, test } from 'vitest';
import { isAccuratePrediction } from '@/lib/analytics/impact';

describe('isAccuratePrediction', () => {
  test.each([
    ['green', 'above', true],
    ['green', 'outlier', true],
    ['green', 'inline', false],
    ['yellow', 'inline', true],
    ['yellow', 'above', true],
    ['yellow', 'below', false],
    ['red', 'below', true],
    ['red', 'inline', true],
    ['red', 'outlier', false],
  ] as const)('%s × %s -> %s', (light, bucket, expected) => {
    expect(isAccuratePrediction(light, bucket)).toBe(expected);
  });
});
