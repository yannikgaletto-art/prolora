import { describe, expect, test } from 'vitest';
import { buildSeedSlots } from '@/lib/posts/schedule-seeding';

describe('buildSeedSlots', () => {
  test('uses neutral business-time fallbacks below 30 posts', () => {
    const result = buildSeedSlots({ frequency: 3, timezone: 'Europe/Berlin', published: [] });
    expect(result.source).toBe('fallback');
    expect(result.slots).toEqual([
      { day_of_week: 2, local_time: '09:00:00' },
      { day_of_week: 3, local_time: '12:00:00' },
      { day_of_week: 4, local_time: '09:00:00' },
    ]);
  });

  test('uses metric windows at 30 posts and fills to requested frequency', () => {
    const published = Array.from({ length: 30 }, (_, index) => ({
      published_at: new Date(Date.UTC(2026, 0, 5, 8)).toISOString(),
      metrics: { likes: 10 + index, comments: 2, shares: 1 },
    }));
    const result = buildSeedSlots({ frequency: 3, timezone: 'Europe/Berlin', published });
    expect(result.source).toBe('metrics');
    expect(result.slots).toHaveLength(3);
    expect(result.slots[0]).toEqual({ day_of_week: 1, local_time: '09:00:00' });
  });

  test('accepts only the 1/3/5 guardrail presets', () => {
    expect(() => buildSeedSlots({ frequency: 6 as 5, timezone: 'UTC', published: [] })).toThrow();
  });
});
