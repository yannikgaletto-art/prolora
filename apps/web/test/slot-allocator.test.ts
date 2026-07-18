import { describe, expect, test } from 'vitest';
import {
  allocateNextSlot,
  localOccurrenceCandidates,
  type PostingSlot,
} from '@/lib/posts/slot-allocator';

const berlinSunday: PostingSlot = {
  id: 'sun', connection_id: null, day_of_week: 0,
  local_time: '02:30:00', timezone: 'Europe/Berlin', is_active: true,
};

describe('localOccurrenceCandidates', () => {
  test('skips the nonexistent spring-forward local time', () => {
    expect(localOccurrenceCandidates('2026-03-29', '02:30:00', 'Europe/Berlin')).toEqual([]);
  });

  test('returns both autumn fold instants in chronological order', () => {
    expect(localOccurrenceCandidates('2026-10-25', '02:30:00', 'Europe/Berlin')).toEqual([
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T01:30:00.000Z',
    ]);
  });
});

describe('allocateNextSlot', () => {
  test('resolves the next valid slot across the spring DST transition', () => {
    const result = allocateNextSlot({
      slots: [berlinSunday], occupiedInstants: [], now: new Date('2026-03-28T12:00:00Z'),
    });
    expect(result?.instant).toBe('2026-04-05T00:30:00.000Z');
    expect(result?.timezone).toBe('Europe/Berlin');
  });

  test('chooses the first future occurrence in the autumn fold', () => {
    const result = allocateNextSlot({
      slots: [berlinSunday], occupiedInstants: [], now: new Date('2026-10-24T12:00:00Z'),
    });
    expect(result?.instant).toBe('2026-10-25T00:30:00.000Z');
  });

  test('skips occupied instants', () => {
    const result = allocateNextSlot({
      slots: [berlinSunday],
      occupiedInstants: ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'],
      now: new Date('2026-10-24T12:00:00Z'),
    });
    expect(result?.instant).toBe('2026-11-01T01:30:00.000Z');
  });

  test('returns null without active slots', () => {
    expect(allocateNextSlot({ slots: [], occupiedInstants: [], now: new Date() })).toBeNull();
    expect(allocateNextSlot({
      slots: [{ ...berlinSunday, is_active: false }], occupiedInstants: [], now: new Date(),
    })).toBeNull();
  });

  test('gets past a completely occupied week', () => {
    const slots: PostingSlot[] = Array.from({ length: 7 }, (_, day) => ({
      id: `d${day}`, connection_id: null, day_of_week: day,
      local_time: '09:00:00', timezone: 'UTC', is_active: true,
    }));
    const occupied = Array.from({ length: 7 }, (_, day) =>
      new Date(Date.UTC(2026, 6, 19 + day, 9)).toISOString()
    );
    const result = allocateNextSlot({
      slots, occupiedInstants: occupied, now: new Date('2026-07-19T08:00:00Z'),
    });
    expect(result?.instant).toBe('2026-07-26T09:00:00.000Z');
  });

  test('with three active slots and two occupied returns the third', () => {
    const slots: PostingSlot[] = [2, 4, 5].map((day) => ({
      id: `d${day}`, connection_id: 'connection', day_of_week: day,
      local_time: '09:00:00', timezone: 'Europe/Berlin', is_active: true,
    }));
    const result = allocateNextSlot({
      slots,
      occupiedInstants: ['2026-07-21T07:00:00.000Z', '2026-07-23T07:00:00.000Z'],
      now: new Date('2026-07-20T08:00:00.000Z'),
    });
    expect(result).toMatchObject({
      slotId: 'd5',
      instant: '2026-07-24T07:00:00.000Z',
      timezone: 'Europe/Berlin',
      localTime: '09:00:00',
    });
  });
});
