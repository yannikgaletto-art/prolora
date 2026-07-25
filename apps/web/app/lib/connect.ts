// GOAL-RUN6 Phase 0: OAuth connects start via fetchApi (JSON) instead of a
// full-page navigation, so pre-consent errors (platform_not_configured,
// invalid_instance, platform_unreachable) render inline in the connect modal
// rather than as a raw JSON error page. Shared by ConnectionsView + ConnectStep.

import { fetchApi, ApiClientError } from '@/app/lib/api';

export type OAuthPlatform = 'linkedin' | 'x' | 'mastodon';

interface ConsentResponse {
  redirect_url: string;
}

// Fetches the consent URL (setting the state/PKCE cookies via the JSON
// response), then hands the browser off to the third-party consent screen.
// Only that hop is a full navigation. Throws ApiClientError on failure.
export async function startOAuthConnect(
  platform: OAuthPlatform,
  params?: { instance?: string }
): Promise<void> {
  const query = new URLSearchParams({ format: 'json' });
  if (params?.instance) query.set('instance', params.instance);
  const { redirect_url } = await fetchApi<ConsentResponse>(`/auth/${platform}?${query.toString()}`);
  window.location.assign(redirect_url);
}

// Client-side mirror of normalizeInstance (lib/auth/oauth-mastodon.ts): trims,
// strips protocol/path and a leading @, lowercases, and validates the domain
// shape. Returns the cleaned domain or null — the server re-validates anyway.
export function normalizeInstanceInput(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned) ? cleaned : null;
}

// Maps structured connect-error codes to an actionable hint shown below the
// server's own message. Returns null when the message alone is enough.
export function connectErrorHint(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  switch (error.code) {
    case 'platform_not_configured':
      return 'The server operator has not added this platform’s app credentials yet.';
    case 'oauth_app_missing':
      // BYO-OAuth: this one the user can fix themselves, right here.
      return 'Add your own developer app for this platform first — the setup panel walks you through it.';
    case 'invalid_instance':
      return 'Enter just the domain of your server, e.g. mastodon.social';
    case 'platform_unreachable':
      return 'The instance did not respond. Check the domain and try again.';
    default:
      return null;
  }
}
