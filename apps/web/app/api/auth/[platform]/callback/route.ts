import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/auth/oauth-state';
import { handleLinkedInCallback } from '@/lib/auth/oauth-linkedin';
import { handleXCallback } from '@/lib/auth/oauth-x';
import { handleMastodonCallback } from '@/lib/auth/oauth-mastodon';
import { PKCE_COOKIE, stateCookieName } from '@/lib/auth/oauth-cookies';

const CALLBACK_PLATFORMS = ['linkedin', 'x', 'mastodon'] as const;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

function redirectWithError(platform: string, code: string): NextResponse {
  const res = NextResponse.redirect(`${appUrl()}/connections?error=${encodeURIComponent(code)}`);
  clearFlowCookies(res, platform);
  return res;
}

function clearFlowCookies(res: NextResponse, platform: string): void {
  res.cookies.set(stateCookieName(platform), '', { maxAge: 0, path: '/api/auth' });
  if (platform === 'x') {
    res.cookies.set(PKCE_COOKIE, '', { maxAge: 0, path: '/api/auth' });
  }
}

// GET /api/auth/{platform}/callback?code=...&state=...
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
): Promise<NextResponse> {
  const { platform } = await params;

  if (!CALLBACK_PLATFORMS.includes(platform as (typeof CALLBACK_PLATFORMS)[number])) {
    return redirectWithError(platform, 'unknown_platform');
  }

  const search = req.nextUrl.searchParams;

  // User denied the consent screen.
  if (search.get('error')) {
    return redirectWithError(platform, 'access_denied');
  }

  const code = search.get('code');
  const state = search.get('state');
  if (!code || !state) {
    return redirectWithError(platform, 'missing_code');
  }

  // CSRF: state must match the value we set as cookie AND carry a valid
  // HMAC with a fresh timestamp (verifyOAuthState).
  const cookieState = req.cookies.get(stateCookieName(platform))?.value;
  if (!cookieState || cookieState !== state) {
    return redirectWithError(platform, 'state_mismatch');
  }
  const verified = verifyOAuthState(state);
  if (!verified) {
    return redirectWithError(platform, 'invalid_state');
  }

  try {
    if (platform === 'linkedin') {
      await handleLinkedInCallback(code, verified.workspaceId);
    } else if (platform === 'x') {
      const verifier = req.cookies.get(PKCE_COOKIE)?.value;
      if (!verifier) {
        return redirectWithError(platform, 'missing_pkce_verifier');
      }
      await handleXCallback(code, verifier, verified.workspaceId);
    } else {
      if (!verified.instance) {
        return redirectWithError(platform, 'missing_instance');
      }
      await handleMastodonCallback(code, verified.workspaceId, verified.instance);
    }
  } catch (error) {
    console.error(`[auth/${platform}/callback] connect failed:`, error);
    return redirectWithError(platform, 'connect_failed');
  }

  const res = NextResponse.redirect(`${appUrl()}/connections?connected=${platform}`);
  clearFlowCookies(res, platform);
  return res;
}
