import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getLinkedInAuthUrl } from '@/lib/auth/oauth-linkedin';
import { generatePkce, getXAuthUrl } from '@/lib/auth/oauth-x';
import { getMastodonAuthUrl } from '@/lib/auth/oauth-mastodon';
import { connectBluesky } from '@/lib/auth/auth-bluesky';
import { connectTelegram } from '@/lib/auth/auth-telegram';
import { toConnectionDto } from '@/lib/auth/connections';
import {
  OAUTH_COOKIE_OPTIONS as COOKIE_OPTIONS,
  PKCE_COOKIE,
  stateCookieName,
} from '@/lib/auth/oauth-cookies';

const OAUTH_PLATFORMS = ['linkedin', 'x', 'mastodon'] as const;
const CREDENTIAL_PLATFORMS = ['bluesky', 'telegram'] as const;

// GOAL-RUN6 Phase 0: with ?format=json the initiate step returns the consent
// URL as JSON instead of a 302. The dashboard calls this via fetchApi so any
// pre-consent error (platform_not_configured, invalid_instance, ...) renders
// inline in the connect modal instead of as a raw JSON error page. The
// Set-Cookie headers (state/PKCE) apply to same-origin fetch responses too.
function consentResponse(url: string, wantsJson: boolean): NextResponse {
  return wantsJson ? NextResponse.json({ redirect_url: url }) : NextResponse.redirect(url);
}

// GET /api/auth/{linkedin|x|mastodon} — initiate the OAuth redirect.
// Mastodon additionally requires ?instance=mastodon.social
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
): Promise<NextResponse> {
  const { platform } = await params;

  try {
    if (!OAUTH_PLATFORMS.includes(platform as (typeof OAUTH_PLATFORMS)[number])) {
      return jsonError(404, `No OAuth flow for platform '${platform}'.`, 'unknown_platform');
    }

    const workspaceId = await getWorkspaceId(req);
    const wantsJson = req.nextUrl.searchParams.get('format') === 'json';

    // LinkedIn/X resolve the workspace's own OAuth app first (BYO), which makes
    // the URL builders async — a missing app surfaces as 503 oauth_app_missing
    // and the picker opens the setup panel instead of a dead end.
    if (platform === 'linkedin') {
      const { url, state } = await getLinkedInAuthUrl(workspaceId);
      const res = consentResponse(url, wantsJson);
      res.cookies.set(stateCookieName(platform), state, COOKIE_OPTIONS);
      return res;
    }

    if (platform === 'x') {
      const pkce = generatePkce();
      const { url, state } = await getXAuthUrl(workspaceId, pkce.challenge);
      const res = consentResponse(url, wantsJson);
      res.cookies.set(stateCookieName(platform), state, COOKIE_OPTIONS);
      res.cookies.set(PKCE_COOKIE, pkce.verifier, COOKIE_OPTIONS);
      return res;
    }

    // mastodon
    const instance = req.nextUrl.searchParams.get('instance');
    if (!instance || !instance.trim()) {
      return jsonError(400, 'Query parameter ?instance= is required for Mastodon.', 'missing_instance');
    }
    const url = await getMastodonAuthUrl(workspaceId, instance);
    const state = new URL(url).searchParams.get('state') ?? '';
    const res = consentResponse(url, wantsJson);
    res.cookies.set(stateCookieName(platform), state, COOKIE_OPTIONS);
    return res;
  } catch (error) {
    return handleRouteError(`auth/${platform}`, error);
  }
}

const blueskyBodySchema = z.object({
  handle: z.string().min(1).max(253),
  app_password: z.string().min(1).max(200),
});

const telegramBodySchema = z.object({
  bot_token: z.string().min(20).max(200),
  chat_id: z.string().min(1).max(64).optional(),
});

// POST /api/auth/{bluesky|telegram} — credential-based connect (no redirect).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
): Promise<NextResponse> {
  const { platform } = await params;

  try {
    if (!CREDENTIAL_PLATFORMS.includes(platform as (typeof CREDENTIAL_PLATFORMS)[number])) {
      return jsonError(404, `Platform '${platform}' does not use credential auth.`, 'unknown_platform');
    }

    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    if (platform === 'bluesky') {
      const { handle, app_password } = blueskyBodySchema.parse(body);
      const connection = await connectBluesky(workspaceId, handle, app_password);
      return NextResponse.json({ connection: toConnectionDto(connection) }, { status: 201 });
    }

    // telegram
    const { bot_token, chat_id } = telegramBodySchema.parse(body);
    const result = await connectTelegram(workspaceId, bot_token, chat_id);
    if (!result.connected) {
      // Token is valid but no chat chosen yet — client shows a picker and
      // POSTs again with chat_id.
      return NextResponse.json(
        { requires_chat_selection: true, available_chats: result.available_chats },
        { status: 200 }
      );
    }
    return NextResponse.json({ connection: toConnectionDto(result.connection) }, { status: 201 });
  } catch (error) {
    return handleRouteError(`auth/${platform}`, error);
  }
}
