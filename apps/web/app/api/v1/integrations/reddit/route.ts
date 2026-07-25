import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import {
  deleteRedditCredentials,
  getRedditIntegrationStatus,
  saveRedditCredentials,
} from '@/lib/integrations/reddit-credentials';

// Reddit app credentials are workspace-owned (migration 014). This route is the
// only way they enter the system from a browser; it answers with status only —
// the secret is never echoed back, not even masked.

// Reddit client IDs are ~22 chars, secrets ~27-30. Bounds are generous on
// purpose: Reddit has changed these lengths before, and the live verification
// below is the real gate.
const credentialsSchema = z.object({
  client_id: z.string().trim().min(8).max(128),
  client_secret: z.string().trim().min(8).max(256),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    return NextResponse.json(await getRedditIntegrationStatus(workspaceId));
  } catch (error) {
    return handleRouteError('v1/integrations/reddit GET', error);
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = credentialsSchema.parse(body);
    const result = await saveRedditCredentials(workspaceId, {
      clientId: input.client_id,
      clientSecret: input.client_secret,
    });

    // A rejected key pair is a form error, not a server fault — 422 keeps it
    // distinguishable from "we could not reach Reddit at all".
    if (!result.ok) {
      return jsonError(422, result.reason, 'reddit_credentials_invalid');
    }
    return NextResponse.json(result.status);
  } catch (error) {
    return handleRouteError('v1/integrations/reddit PUT', error);
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    await deleteRedditCredentials(workspaceId);
    return NextResponse.json(await getRedditIntegrationStatus(workspaceId));
  } catch (error) {
    return handleRouteError('v1/integrations/reddit DELETE', error);
  }
}
