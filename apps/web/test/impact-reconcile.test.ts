// GOAL-RUN8 T2.4 — only mature metric snapshots enter a connection baseline.
import { describe, expect, test } from 'vitest';
import {
  hasReachedReconciliationAge,
  matureHistoryEngagement,
} from '@/lib/scoring/reconcile';

describe('reconciliation maturity', () => {
  test('requires 48 hours before reconciling the target post', () => {
    const publishedAt = '2026-07-01T00:00:00.000Z';
    expect(hasReachedReconciliationAge(publishedAt, new Date('2026-07-02T23:59:59.000Z'))).toBe(false);
    expect(hasReachedReconciliationAge(publishedAt, new Date('2026-07-03T00:00:00.000Z'))).toBe(true);
  });

  test('keeps only snapshots taken at least 40 hours after publication', () => {
    const rows = [
      {
        metrics: { likes: 5, comments: 2, shares: 1 },
        published_at: '2026-07-01T00:00:00.000Z',
        metrics_updated_at: '2026-07-02T16:00:00.000Z',
      },
      {
        metrics: { likes: 99, comments: 99, shares: 99 },
        published_at: '2026-07-01T00:00:00.000Z',
        metrics_updated_at: '2026-07-02T15:59:59.000Z',
      },
      {
        metrics: {},
        published_at: null,
        metrics_updated_at: null,
      },
    ];

    expect(matureHistoryEngagement(rows)).toEqual([12]);
  });
});
