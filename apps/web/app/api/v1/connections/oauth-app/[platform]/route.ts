import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import {
  byoRedirectUri,
  isByoOAuthPlatform,
  oauthAppProvider,
  oauthPlatformLabel,
} from '@/lib/auth/byo-oauth';
import {
  deleteCredential,
  getIntegrationStatus,
  saveCredential,
} from '@/lib/integrations/credentials';

// The workspace's own LinkedIn/X developer app. This route is the only way the
// client ID/secret enter the system from a browser; it answers with status plus
// the redirect URI the user has to register — never with the secret, not even
// masked.

const credentialsSchema = z.object({
  client_id: z.string().trim().min(6).max(128),
  client_secret: z.string().trim().min(6).max(256),
});

interface RouteContext {
  params: Promise<{ platform: string }>;
}

async function resolvePlatform(context: RouteContext) {
  const { platform } = await context.params;
  if (!isByoOAuthPlatform(platform)) {
    return null;
  }
  return platform;
}

async function statusPayload(workspaceId: string, platform: 'linkedin' | 'x') {
  const status = await getIntegrationStatus(workspaceId, oauthAppProvider(platform));
  return {
    platform,
    label: oauthPlatformLabel(platform),
    // The user must paste this into their own app — showing it here is the
    // difference between a two-minute setup and a support ticket.
    redirect_uri: byoRedirectUri(platform),
    connected: status.connected,
    source: status.source,
    clientIdHint: status.clientIdHint,
    verifiedAt: status.verifiedAt,
    lastError: status.lastError,
  };
}

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const platform = await resolvePlatform(context);
    if (!platform) {
      return jsonError(404, 'This platform does not use a bring-your-own OAuth app.', 'unknown_platform');
    }
    const workspaceId = await getWorkspaceId(req);
    return NextResponse.json(await statusPayload(workspaceId, platform));
  } catch (error) {
    return handleRouteError('v1/connections/oauth-app GET', error);
  }
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const platform = await resolvePlatform(context);
    if (!platform) {
      return jsonError(404, 'This platform does not use a bring-your-own OAuth app.', 'unknown_platform');
    }
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = credentialsSchema.parse(body);
    const result = await saveCredential(workspaceId, oauthAppProvider(platform), {
      clientId: input.client_id,
      clientSecret: input.client_secret,
    });

    // A malformed pair is a form error, not a server fault. Whether the pair is
    // genuinely valid can only be proven by completing the redirect — the
    // consent screen is the real verification step (see providers/oauth-apps.ts).
    if (!result.ok) {
      return jsonError(422, result.reason, 'oauth_app_invalid');
    }
    return NextResponse.json(await statusPayload(workspaceId, platform));
  } catch (error) {
    return handleRouteError('v1/connections/oauth-app PUT', error);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const platform = await resolvePlatform(context);
    if (!platform) {
      return jsonError(404, 'This platform does not use a bring-your-own OAuth app.', 'unknown_platform');
    }
    const workspaceId = await getWorkspaceId(req);
    await deleteCredential(workspaceId, oauthAppProvider(platform));
    return NextResponse.json(await statusPayload(workspaceId, platform));
  } catch (error) {
    return handleRouteError('v1/connections/oauth-app DELETE', error);
  }
}
