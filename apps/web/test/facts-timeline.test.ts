import { describe, expect, test } from 'vitest';
import {
  resolveFactsAt,
  validateFactDirectionChange,
  type ConfirmedFact,
} from '@/lib/product/facts';

const fact = (overrides: Partial<ConfirmedFact> = {}): ConfirmedFact => ({
  id: 'fact-1',
  factKey: 'pathly.users.active',
  factKind: 'metric',
  value: { number: 68 },
  unit: 'users',
  effectiveFrom: '2026-07-01T00:00:00.000Z',
  effectiveTo: '2026-07-15T00:00:00.000Z',
  status: 'superseded',
  directionPolicy: 'warn_on_decrease',
  changeReason: null,
  verifiedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('Facts Timeline', () => {
  test('resolves the fact that was confirmed for the requested point in time', () => {
    const history = [
      fact(),
      fact({
        id: 'fact-2',
        value: { number: 100 },
        effectiveFrom: '2026-07-15T00:00:00.000Z',
        effectiveTo: null,
        status: 'confirmed',
      }),
    ];

    expect(resolveFactsAt(history, '2026-07-10T00:00:00.000Z')[0]?.value).toEqual({ number: 68 });
    expect(resolveFactsAt(history, '2026-08-01T00:00:00.000Z')[0]?.value).toEqual({ number: 100 });
  });

  test('never resolves revoked, future, or unconfirmed records', () => {
    expect(resolveFactsAt([
      fact({ status: 'revoked', effectiveTo: null }),
      fact({ id: 'future', status: 'confirmed', effectiveFrom: '2027-01-01T00:00:00.000Z', effectiveTo: null }),
    ], '2026-08-01T00:00:00.000Z')).toEqual([]);
  });

  test('requires a written reason when a directional metric reverses', () => {
    expect(() => validateFactDirectionChange(
      fact({ status: 'confirmed', effectiveTo: null, value: { number: 100 } }),
      { number: 68 },
      null
    )).toThrow(/reason/i);
    expect(() => validateFactDirectionChange(
      fact({ status: 'confirmed', effectiveTo: null, value: { number: 100 } }),
      { number: 68 },
      'Metric definition changed after removing test accounts.'
    )).not.toThrow();
  });
});
