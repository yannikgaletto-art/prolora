import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { webhookCreateSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type WebhookRow } from '@/lib/db';
import { encrypt } from '@/lib/auth/encryption';

// GET /api/v1/webhooks — list (secret NEVER included)
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const db = getServiceDb();

    const { data, error } = await db
      .from('webhooks')
      .select('id, url, events, active, last_triggered_at, failure_count, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .returns<Array<Omit<WebhookRow, 'secret_encrypted' | 'workspace_id'>>>();
    if (error) {
      throw new Error(`[v1/webhooks] query failed: ${error.message}`);
    }

    return NextResponse.json({ webhooks: data ?? [] });
  } catch (error) {
    return handleRouteError('v1/webhooks GET', error);
  }
}

// POST /api/v1/webhooks — register. The signing secret is generated
// server-side, stored ENCRYPTED (Invariante 1) and returned exactly once.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const { url, events } = webhookCreateSchema.parse(body);
    const secret = `whsec_${randomBytes(32).toString('base64url')}`;

    const db = getServiceDb();
    const { data: created, error } = await db
      .from('webhooks')
      .insert({
        workspace_id: workspaceId,
        url,
        events,
        secret_encrypted: encrypt(secret),
        active: true,
      })
      .select('id, url, events, active, created_at')
      .single<Pick<WebhookRow, 'id' | 'url' | 'events' | 'active' | 'created_at'>>();
    if (error || !created) {
      throw new Error(`[v1/webhooks] insert failed: ${error?.message ?? 'no row'}`);
    }

    return NextResponse.json(
      {
        webhook: created,
        // Shown once — the stored copy is encrypted.
        secret,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError('v1/webhooks POST', error);
  }
}
