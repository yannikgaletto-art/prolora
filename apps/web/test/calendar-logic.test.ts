// GOAL-RUN6 Phase 2 — pure calendar logic. The rollup precedence drives the
// dot color: anything needing attention (failed/publishing) must win over
// routine states, and drafts must be visible over published history.
import { describe, expect, test } from 'vitest';
import { rollupGroupStatus, validateCalendarRange, MAX_RANGE_DAYS } from '@/lib/posts/calendar';

describe('rollupGroupStatus', () => {
  test('failed wins over everything', () => {
    expect(rollupGroupStatus(['published', 'failed', 'scheduled'])).toBe('failed');
  });

  test('publishing wins over scheduled and published', () => {
    expect(rollupGroupStatus(['published', 'publishing', 'scheduled'])).toBe('publishing');
  });

  test('draft is visible over published (mixed group)', () => {
    expect(rollupGroupStatus(['published', 'draft'])).toBe('draft');
  });

  test('uniform groups roll up to their own status', () => {
    expect(rollupGroupStatus(['scheduled', 'scheduled'])).toBe('scheduled');
    expect(rollupGroupStatus(['draft'])).toBe('draft');
    expect(rollupGroupStatus(['published'])).toBe('published');
  });

  test('empty and deleted-only groups roll up to deleted (hidden)', () => {
    expect(rollupGroupStatus([])).toBe('deleted');
    expect(rollupGroupStatus(['deleted', 'deleted'])).toBe('deleted');
  });
});

describe('validateCalendarRange', () => {
  const base = new Date('2026-07-01T00:00:00.000Z');

  test('accepts a normal month grid window', () => {
    const to = new Date(base.getTime() + 42 * 24 * 60 * 60 * 1000);
    expect(validateCalendarRange(base.toISOString(), to.toISOString())).toBeNull();
  });

  test('rejects inverted and equal ranges', () => {
    expect(validateCalendarRange(base.toISOString(), base.toISOString())).toMatch(/after/);
  });

  test('rejects ranges over the cap', () => {
    const to = new Date(base.getTime() + (MAX_RANGE_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(validateCalendarRange(base.toISOString(), to.toISOString())).toMatch(/exceeds/i);
  });

  test('rejects malformed timestamps', () => {
    expect(validateCalendarRange('not-a-date', base.toISOString())).toMatch(/valid ISO/);
  });
});
