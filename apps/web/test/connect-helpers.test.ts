// GOAL-RUN6 Phase 0: client-side connect helpers. normalizeInstanceInput must
// mirror the server's normalizeInstance (lib/auth/oauth-mastodon.ts) so the
// modal rejects exactly what the server would reject — plus the leading-@
// convenience strip the server does not do.
import { describe, expect, test } from 'vitest';
import { normalizeInstanceInput, connectErrorHint } from '@/app/lib/connect';
import { ApiClientError } from '@/app/lib/api';

describe('normalizeInstanceInput', () => {
  test('accepts a plain domain', () => {
    expect(normalizeInstanceInput('mastodon.social')).toBe('mastodon.social');
  });

  test('strips protocol, path and trailing slash', () => {
    expect(normalizeInstanceInput('https://Mastodon.Social/')).toBe('mastodon.social');
    expect(normalizeInstanceInput('https://troet.cafe/@user')).toBe('troet.cafe');
  });

  test('strips a leading @', () => {
    expect(normalizeInstanceInput('@mastodon.social')).toBe('mastodon.social');
  });

  test('lowercases and trims whitespace', () => {
    expect(normalizeInstanceInput('  MASTODON.SOCIAL  ')).toBe('mastodon.social');
  });

  test('rejects the live-bug inputs: empty, whitespace-only, malformed', () => {
    expect(normalizeInstanceInput('')).toBeNull();
    expect(normalizeInstanceInput('   ')).toBeNull();
    expect(normalizeInstanceInput('mastodon')).toBeNull();
    expect(normalizeInstanceInput('http://')).toBeNull();
    expect(normalizeInstanceInput('not a domain')).toBeNull();
  });
});

describe('connectErrorHint', () => {
  test('maps known connect error codes to actionable hints', () => {
    expect(connectErrorHint(new ApiClientError(500, 'X is not configured on this server.', 'platform_not_configured'))).toMatch(/operator/i);
    expect(connectErrorHint(new ApiClientError(400, 'Invalid Mastodon instance URL.', 'invalid_instance'))).toMatch(/mastodon\.social/);
    expect(connectErrorHint(new ApiClientError(502, 'Could not reach instance.', 'platform_unreachable'))).toMatch(/did not respond/i);
  });

  test('returns null for unknown codes and non-API errors', () => {
    expect(connectErrorHint(new ApiClientError(500, 'Internal server error.', 'internal_error'))).toBeNull();
    expect(connectErrorHint(new Error('boom'))).toBeNull();
  });
});
