import { describe, expect, it } from 'vitest';
import {
  computeChannelCapacity,
  dailyWindowStart,
  nextDailyReset,
  PLATFORM_DAILY_POST_LIMITS,
} from '../lib/connections/capacity';
import type { ConnectionRow } from '../lib/db';

const NOW = new Date('2026-07-25T12:00:00.000Z');

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: 'conn-1',
    workspace_id: 'ws-1',
    platform: 'x',
    account_name: '@ada',
    account_id: '1',
    account_type: 'personal',
    avatar_url: null,
    access_token_encrypted: 'v2:aa:bb:cc',
    refresh_token_encrypted: 'v2:dd:ee:ff',
    token_expires_at: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    app_password_encrypted: null,
    bot_token_encrypted: null,
    scopes: [],
    status: 'active',
    config: {},
    last_used_at: null,
    last_health_check: null,
    rate_limit_state: {},
    refresh_locked_until: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeChannelCapacity', () => {
  it('subtracts what was already published today from the platform cap', () => {
    const capacity = computeChannelCapacity(connection(), 12, NOW);
    expect(capacity.remainingToday).toBe(PLATFORM_DAILY_POST_LIMITS.x! - 12);
    expect(capacity.blocked).toBe(false);
    expect(capacity.nextResetAt).toBe('2026-07-26T00:00:00.000Z');
  });

  it('returns null — unlimited — for platforms that publish no daily cap', () => {
    const capacity = computeChannelCapacity(connection({ platform: 'bluesky' }), 40, NOW);
    expect(capacity.remainingToday).toBeNull();
    expect(capacity.nextResetAt).toBeNull();
    expect(capacity.blocked).toBe(false);
  });

  it('lets the live rate-limit budget override the daily cap when it is tighter', () => {
    const resetAt = new Date(NOW.getTime() + 15 * 60 * 1000).toISOString();
    const capacity = computeChannelCapacity(
      connection({ rate_limit_state: { remaining: 3, limit: 100, reset_at: resetAt } }),
      0,
      NOW
    );

    expect(capacity.remainingToday).toBe(3);
    // The binding constraint decides which reset the caller has to wait for.
    expect(capacity.nextResetAt).toBe(resetAt);
    expect(capacity.blocked).toBe(false);
  });

  it('ignores a rate-limit budget whose window has already rolled over', () => {
    const capacity = computeChannelCapacity(
      connection({
        rate_limit_state: {
          remaining: 0,
          limit: 100,
          reset_at: new Date(NOW.getTime() - 60_000).toISOString(),
        },
      }),
      5,
      NOW
    );

    expect(capacity.remainingToday).toBe(PLATFORM_DAILY_POST_LIMITS.x! - 5);
    expect(capacity.blocked).toBe(false);
  });

  it('blocks on an exhausted budget and points at its reset', () => {
    const resetAt = new Date(NOW.getTime() + 20 * 60 * 1000).toISOString();
    const capacity = computeChannelCapacity(
      connection({ rate_limit_state: { remaining: 0, limit: 100, reset_at: resetAt } }),
      0,
      NOW
    );

    expect(capacity).toMatchObject({
      remainingToday: 0,
      blocked: true,
      blockedReason: 'rate_limited',
      nextResetAt: resetAt,
    });
  });

  it('blocks when the daily cap alone is used up', () => {
    const capacity = computeChannelCapacity(connection({ platform: 'linkedin' }), 150, NOW);
    expect(capacity).toMatchObject({
      remainingToday: 0,
      blocked: true,
      blockedReason: 'rate_limited',
      nextResetAt: '2026-07-26T00:00:00.000Z',
    });
  });

  it('never reports a negative allowance after an over-count', () => {
    const capacity = computeChannelCapacity(connection({ platform: 'linkedin' }), 400, NOW);
    expect(capacity.remainingToday).toBe(0);
  });

  it('applies a limit that is unlimited on one side but budgeted on the other', () => {
    const resetAt = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
    const capacity = computeChannelCapacity(
      connection({
        platform: 'mastodon',
        rate_limit_state: { remaining: 7, limit: 300, reset_at: resetAt },
      }),
      0,
      NOW
    );
    expect(capacity.remainingToday).toBe(7);
    expect(capacity.nextResetAt).toBe(resetAt);
  });

  it('ignores rate-limit JSON that does not have the shape publish-post writes', () => {
    const capacity = computeChannelCapacity(
      connection({ rate_limit_state: { foo: 'bar' } }),
      0,
      NOW
    );
    expect(capacity.remainingToday).toBe(PLATFORM_DAILY_POST_LIMITS.x);
  });
});

describe('daily window', () => {
  it('counts from midnight UTC to the next midnight UTC', () => {
    expect(dailyWindowStart(NOW)).toBe('2026-07-25T00:00:00.000Z');
    expect(nextDailyReset(NOW)).toBe('2026-07-26T00:00:00.000Z');
  });
});
