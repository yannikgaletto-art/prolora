// Client ID/secret are workspace-owned (lib/auth/byo-oauth.ts) with the env as
// fallback; the redirect URI and the HMAC-signed state stay ours in both cases.
import { encrypt } from '@/lib/auth/encryption';
import { saveConnection } from '@/lib/auth/connections';
import { createOAuthState } from '@/lib/auth/oauth-state';
import { assertOwnRedirectUri, byoRedirectUri, resolveOAuthApp } from '@/lib/auth/byo-oauth';
import { ApiError } from '@/lib/api/http';
import type { ConnectionRow } from '@/lib/db';

const SCOPES = 'openid profile email w_member_social';

function redirectUri(): string {
  return assertOwnRedirectUri(byoRedirectUri('linkedin'));
}

export async function getLinkedInAuthUrl(
  workspaceId: string
): Promise<{ url: string; state: string }> {
  const { clientId } = await resolveOAuthApp(workspaceId, 'linkedin');
  const state = createOAuthState(workspaceId);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
  });
  return { url: `https://www.linkedin.com/oauth/v2/authorization?${params}`, state };
}

interface LinkedInTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

interface LinkedInUserInfo {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

export async function handleLinkedInCallback(
  code: string,
  workspaceId: string
): Promise<ConnectionRow> {
  const { clientId, clientSecret } = await resolveOAuthApp(workspaceId, 'linkedin');

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (error) {
    console.error('[oauth-linkedin] token exchange request failed:', error);
    throw new ApiError(502, 'Could not reach LinkedIn.', 'platform_unreachable');
  }

  if (!tokenResponse.ok) {
    console.error('[oauth-linkedin] token exchange failed:', tokenResponse.status, await tokenResponse.text());
    throw new ApiError(400, 'LinkedIn authorization failed. Please try again.', 'oauth_failed');
  }

  const tokens = (await tokenResponse.json()) as Partial<LinkedInTokens>;
  if (!tokens.access_token || !tokens.expires_in) {
    throw new ApiError(502, 'LinkedIn returned an incomplete token response.', 'platform_error');
  }

  // member id (userinfo.sub) is required later for the author URN when publishing.
  const userResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userResponse.ok) {
    console.error('[oauth-linkedin] userinfo failed:', userResponse.status, await userResponse.text());
    throw new ApiError(502, 'Could not load your LinkedIn profile.', 'platform_error');
  }
  const user = (await userResponse.json()) as Partial<LinkedInUserInfo>;
  if (!user.sub) {
    throw new ApiError(502, 'LinkedIn profile response was incomplete.', 'platform_error');
  }

  return saveConnection({
    workspaceId,
    platform: 'linkedin',
    accountName: user.name ?? user.sub,
    accountId: user.sub,
    avatarUrl: user.picture ?? null,
    accessTokenEncrypted: encrypt(tokens.access_token),
    refreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: SCOPES.split(' '),
    config: {
      member_urn: `urn:li:person:${user.sub}`,
      email: user.email ?? null,
    },
  });
}
