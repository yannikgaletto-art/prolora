import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import {
  deleteCredential,
  getIntegrationStatus,
  saveCredential,
} from '@/lib/integrations/credentials';
import { isIntegrationProvider, type StoredCredential } from '@/lib/integrations/types';
import { credentialFieldsFor, getProviderDescriptor } from '@/lib/integrations/registry';

// Replaces the Reddit-only /api/v1/integrations/reddit route. Same URL for
// Reddit, same contract for every other provider: status in, status out, and
// the secret never echoed back — not even masked.
//
// The request body is validated against the provider's *descriptor* rather than
// a hand-written schema per provider, so a new provider needs no route change.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) {
      return jsonError(404, `Unknown integration "${provider}".`, 'unknown_provider');
    }
    return NextResponse.json(await getIntegrationStatus(workspaceId, provider));
  } catch (error) {
    return handleRouteError('v1/integrations/[provider] GET', error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) {
      return jsonError(404, `Unknown integration "${provider}".`, 'unknown_provider');
    }

    const descriptor = getProviderDescriptor(provider);
    const fields = credentialFieldsFor(descriptor);
    if (fields.length === 0) {
      // 'none' and 'reuse_connection' have nothing to store. Saying so beats
      // accepting a write that could never be read back.
      return jsonError(
        400,
        descriptor.credentialKind === 'none'
          ? `${descriptor.label} needs no credentials — it is available already.`
          : `${descriptor.label} reuses an existing connection. Connect it under Channels instead.`,
        'no_credentials_required'
      );
    }

    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    // Both shapes are accepted: the descriptor field names (clientId) and the
    // snake_case aliases the old Reddit route published (client_id).
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const field of fields) {
      shape[field.name] = z.string().trim().min(field.minLength).max(field.maxLength);
    }
    const parsed = z.object(shape).parse(normaliseBody(body, fields.map((f) => f.name)));

    const credential: StoredCredential = {};
    for (const field of fields) {
      credential[field.name] = parsed[field.name] as string;
    }

    const result = await saveCredential(workspaceId, provider, credential);
    // A rejected credential is a form error, not a server fault — 422 keeps it
    // distinguishable from "we could not reach the provider at all".
    if (!result.ok) {
      return jsonError(422, result.reason, 'credentials_invalid');
    }
    return NextResponse.json(result.status);
  } catch (error) {
    return handleRouteError('v1/integrations/[provider] PUT', error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) {
      return jsonError(404, `Unknown integration "${provider}".`, 'unknown_provider');
    }
    await deleteCredential(workspaceId, provider);
    return NextResponse.json(await getIntegrationStatus(workspaceId, provider));
  } catch (error) {
    return handleRouteError('v1/integrations/[provider] DELETE', error);
  }
}

/** `client_id` -> `clientId`, so existing API callers keep working. */
function normaliseBody(body: unknown, fieldNames: string[]): Record<string, unknown> {
  const source = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  for (const name of fieldNames) {
    if (out[name] !== undefined) continue;
    const snake = name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (source[snake] !== undefined) out[name] = source[snake];
  }
  return out;
}
