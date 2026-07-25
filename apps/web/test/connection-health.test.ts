import { describe, expect, it } from 'vitest';
import {
  classifyConnectionHealth,
  shouldRequestRefresh,
  stateFromStatus,
  EXPIRY_WARNING_DAYS,
} from '../lib/connections/health';
import { computeChannelCapacity } from '../lib/connections/capacity';
import type { ConnectionRow } from '../lib/db';

const NOW = new Date('2026-07-25T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function connection(overrides: Partial<ConnectionRow> = {}): ConnectionRow {
  return {
    id: 'conn-1',
    workspace_id: 'ws-1',
    platform: 'linkedin',
    account_name: 'Ada Lovelace',
    account_id: 'urn:li:person:1',
    account_type: 'personal',
    avatar_url: null,
    access_token_encrypted: 'v2:aa:bb:cc',
    refresh_token_encrypted: 'v2:dd:ee:ff',
    token_expires_at: new Date(NOW.getTime() + 60 * DAY_MS).toISOString(),
    app_password_encrypted: null,
    bot_token_encrypted: null,
    scopes: ['w_member_social'],
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

describe('classifyConnectionHealth', () => {
  it('calls a far-off token healthy', () => {
    const health = classifyConnectionHealth(connection(), NOW);
    expect(health.state).toBe('healthy');
    expect(health.expiresInDays).toBe(60);
    expect(health.canAutoRefresh).toBe(true);
  });

  it('warns inside the seven-day window before expiry', () => {
    const health = classifyConnectionHealth(
      connection({ token_expires_at: new Date(NOW.getTime() + 5 * DAY_MS).toISOString() }),
      NOW
    );
    expect(health.state).toBe('expiring_soon');
    expect(health.expiresInDays).toBe(5);
    // The boundary belongs to the warning, not to "healthy".
    expect(
      classifyConnectionHealth(
        connection({
          token_expires_at: new Date(NOW.getTime() + EXPIRY_WARNING_DAYS * DAY_MS).toISOString(),
        }),
        NOW
      ).state
    ).toBe('expiring_soon');
  });

  it('calls a lapsed token expired even while the row still says active', () => {
    const health = classifyConnectionHealth(
      connection({ token_expires_at: new Date(NOW.getTime() - DAY_MS).toISOString() }),
      NOW
    );
    expect(health.state).toBe('expired');
    // Divergence from the coarse status column is exactly what makes it a change.
    expect(health.previousState).toBe('healthy');
  });

  it('trusts a failed live probe over an optimistic expiry date', () => {
    const health = classifyConnectionHealth(
      connection({ last_health_check: { checked_at: NOW.toISOString(), ok: false } }),
      NOW
    );
    expect(health.state).toBe('expired');
    expect(health.lastCheckOk).toBe(false);
  });

  it('keeps revoked distinct from expired — reconnecting is the only fix', () => {
    const health = classifyConnectionHealth(connection({ status: 'revoked' }), NOW);
    expect(health.state).toBe('revoked');
    expect(health.previousState).toBe('revoked');
    expect(shouldRequestRefresh(health)).toBe(false);
  });

  it('treats a credential without an expiry as healthy rather than unknown', () => {
    const health = classifyConnectionHealth(
      connection({ platform: 'bluesky', token_expires_at: null, refresh_token_encrypted: null }),
      NOW
    );
    expect(health.state).toBe('healthy');
    expect(health.expiresInDays).toBeNull();
    expect(shouldRequestRefresh(health)).toBe(false);
  });

  it('asks the existing refresh pipeline for help only when it can help', () => {
    const expiring = classifyConnectionHealth(
      connection({ token_expires_at: new Date(NOW.getTime() + 2 * DAY_MS).toISOString() }),
      NOW
    );
    expect(shouldRequestRefresh(expiring)).toBe(true);

    const noRefreshToken = classifyConnectionHealth(
      connection({
        token_expires_at: new Date(NOW.getTime() + 2 * DAY_MS).toISOString(),
        refresh_token_encrypted: null,
      }),
      NOW
    );
    expect(shouldRequestRefresh(noRefreshToken)).toBe(false);
  });
});

describe('stateFromStatus', () => {
  it('collapses the status column into the same vocabulary', () => {
    expect(stateFromStatus('active')).toBe('healthy');
    expect(stateFromStatus('expired')).toBe('expired');
    expect(stateFromStatus('error')).toBe('expired');
    expect(stateFromStatus('revoked')).toBe('revoked');
  });
});

describe('health feeds capacity', () => {
  it('gives an expired token no capacity, whatever the rate-limit budget says', () => {
    const capacity = computeChannelCapacity(
      connection({
        token_expires_at: new Date(NOW.getTime() - DAY_MS).toISOString(),
        rate_limit_state: {
          remaining: 99,
          limit: 100,
          reset_at: new Date(NOW.getTime() + 3600_000).toISOString(),
        },
      }),
      0,
      NOW
    );

    expect(capacity).toMatchObject({
      remainingToday: 0,
      blocked: true,
      blockedReason: 'token_expired',
    });
  });

  it('reports a revoked channel as revoked, not as rate limited', () => {
    const capacity = computeChannelCapacity(connection({ status: 'revoked' }), 0, NOW);
    expect(capacity).toMatchObject({ blocked: true, blockedReason: 'revoked', remainingToday: 0 });
  });

  it('leaves an expiring-soon channel fully usable — it still works today', () => {
    const capacity = computeChannelCapacity(
      connection({ token_expires_at: new Date(NOW.getTime() + 3 * DAY_MS).toISOString() }),
      0,
      NOW
    );
    expect(capacity.blocked).toBe(false);
    expect(capacity.remainingToday).toBe(150);
  });
});
