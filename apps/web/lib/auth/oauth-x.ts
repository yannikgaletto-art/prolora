// Client ID/secret are workspace-owned (lib/auth/byo-oauth.ts) with the env as
// fallback; the redirect URI, PKCE verifier and HMAC-signed state stay ours.
import { createHash, randomBytes } from 'crypto';
import { encrypt } from '@/lib/auth/encryption';
import { saveConnection } from '@/lib/auth/connections';
import { createOAuthState } from '@/lib/auth/oauth-state';
import { assertOwnRedirectUri, byoRedirectUri, resolveOAuthApp } from '@/lib/auth/byo-oauth';
import { ApiError } from '@/lib/api/http';
import type { ConnectionRow } from '@/lib/db';

const SCOPES = 'tweet.read tweet.write users.read offline.access';

function redirectUri(): string {
  return assertOwnRedirectUri(byoRedirectUri('x'));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

// PKCE: verifier lives in an HTTP-only cookie for the duration of the flow
// (short-lived — never stored in the DB).
export function generatePkce(): PkcePair {
  const verifier = randomBytes(64).toString('base64url'); // 86 chars, within 43-128 spec
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function getXAuthUrl(
  workspaceId: string,
  challenge: string
): Promise<{ url: string; state: string }> {
  const { clientId } = await resolveOAuthApp(workspaceId, 'x');
  const state = createOAuthState(workspaceId);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `https://twitter.com/i/oauth2/authorize?${params}`, state };
}

interface XTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface XUser {
  id: string;
  name: string;
  username: string;
}

export async function handleXCallback(
  code: string,
  codeVerifier: string,
  workspaceId: string
): Promise<ConnectionRow> {
  const { clientId, clientSecret } = await resolveOAuthApp(workspaceId, 'x');

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        code_verifier: codeVerifier,
        client_id: clientId,
      }),
    });
  } catch (error) {
    console.error('[oauth-x] token exchange request failed:', error);
    throw new ApiError(502, 'Could not reach X.', 'platform_unreachable');
  }

  if (!tokenResponse.ok) {
    console.error('[oauth-x] token exchange failed:', tokenResponse.status, await tokenResponse.text());
    throw new ApiError(400, 'X authorization failed. Please try again.', 'oauth_failed');
  }

  const tokens = (await tokenResponse.json()) as Partial<XTokens>;
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    throw new ApiError(502, 'X returned an incomplete token response.', 'platform_error');
  }

  const userResponse = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userResponse.ok) {
    console.error('[oauth-x] users/me failed:', userResponse.status, await userResponse.text());
    throw new ApiError(502, 'Could not load your X profile.', 'platform_error');
  }
  const userJson = (await userResponse.json()) as { data?: Partial<XUser> };
  const user = userJson.data;
  if (!user?.id || !user.username) {
    throw new ApiError(502, 'X profile response was incomplete.', 'platform_error');
  }

  return saveConnection({
    workspaceId,
    platform: 'x',
    accountName: `@${user.username}`,
    accountId: user.id,
    accessTokenEncrypted: encrypt(tokens.access_token),
    refreshTokenEncrypted: encrypt(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: SCOPES.split(' '),
    config: { username: user.username },
  });
}
