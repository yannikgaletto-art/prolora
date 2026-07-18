// AI media generation — pure pieces of the budget model (spec: unit tests for
// estimate calculation and the calendar-month ledger key).
import { describe, expect, test } from 'vitest';
import { estimateEur, monthKey, MEDIA_PRICES, MEDIA_BUDGET_LIMIT_EUR } from '@/lib/media/generation';

describe('monthKey', () => {
  test('formats the UTC calendar month', () => {
    expect(monthKey(new Date('2026-07-17T23:59:59.000Z'))).toBe('2026-07');
    expect(monthKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01');
    expect(monthKey(new Date('2026-12-31T23:00:00.000Z'))).toBe('2026-12');
  });
});

describe('estimateEur', () => {
  test('mirrors the versioned price config', () => {
    expect(estimateEur('image')).toBe(MEDIA_PRICES.image.estimated_eur);
    expect(estimateEur('video')).toBe(MEDIA_PRICES.video.estimated_eur);
  });

  test('a single video plus images cannot silently exceed the monthly limit', () => {
    // Sanity guard on the config itself: the limit must allow at least one
    // video and one image in the same month, and both prices are positive.
    expect(estimateEur('image')).toBeGreaterThan(0);
    expect(estimateEur('video')).toBeGreaterThan(estimateEur('image'));
    expect(estimateEur('video') + estimateEur('image')).toBeLessThan(MEDIA_BUDGET_LIMIT_EUR);
  });
});
