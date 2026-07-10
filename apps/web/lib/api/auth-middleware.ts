import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { hashApiKey } from '@/lib/auth/encryption';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getServiceDb, type ApiKeyRow } from '@/lib/db';
import { ApiError } from '@/lib/api/http';

const API_KEY_HEADER = 'x-prolora-key';
const KEY_PREFIX_LENGTH = 14;

export interface AuthContext {
  workspaceId: string;
  method: 'api_key' | 'session';
  userId?: string;
  apiKeyId?: string;
}

// Central auth for every API endpoint. Two paths:
// 1. x-prolora-key header -> SHA-256 hash -> api_keys lookup (prefix + hash)
// 2. Supabase session cookie -> auth.getUser() -> workspace membership
export async function authenticate(req: NextRequest): Promise<AuthContext> {
  const apiKey = req.headers.get(API_KEY_HEADER);
  if (apiKey) {
    return authenticateApiKey(apiKey);
  }
  return authenticateSession(req);
}

export async function getWorkspaceId(req: NextRequest): Promise<string> {
  const ctx = await authenticate(req);
  return ctx.workspaceId;
}

async function authenticateApiKey(apiKey: string): Promise<AuthContext> {
  if (!apiKey.startsWith('sk_live_') || apiKey.length < 40) {
    throw new ApiError(401, 'Invalid API key.', 'invalid_api_key');
  }

  const prefix = apiKey.slice(0, KEY_PREFIX_LENGTH);
  const hash = hashApiKey(apiKey);
  const db = getServiceDb();

  const { data, error } = await db
    .from('api_keys')
    .select('id, workspace_id, key_hash, revoked_at')
    .eq('key_prefix', prefix)
    .is('revoked_at', null)
    .returns<Pick<ApiKeyRow, 'id' | 'workspace_id' | 'key_hash' | 'revoked_at'>[]>();

  if (error) {
    console.error('[auth-middleware] api_keys lookup failed:', error.message);
    throw new ApiError(500, 'Authentication temporarily unavailable.', 'auth_unavailable');
  }

  const match = (data ?? []).find((row) => safeHashCompare(row.key_hash, hash));
  if (!match) {
    throw new ApiError(401, 'Invalid API key.', 'invalid_api_key');
  }

  // last_used_at is best-effort telemetry — fire-and-forget, never block auth.
  void db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', match.id)
    .then(({ error: updateError }) => {
      if (updateError) {
        console.error('[auth-middleware] last_used_at update failed:', updateError.message);
      }
    });

  return { workspaceId: match.workspace_id, method: 'api_key', apiKeyId: match.id };
}

async function authenticateSession(req: NextRequest): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiError(401, 'Authentication required. Provide an API key or sign in.', 'unauthenticated');
  }

  const requestedWorkspaceId =
    req.headers.get('x-workspace-id') ?? req.nextUrl.searchParams.get('workspace_id');

  const db = getServiceDb();
  const membershipQuery = db
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id);

  if (requestedWorkspaceId) {
    const { data, error: memberError } = await membershipQuery
      .eq('workspace_id', requestedWorkspaceId)
      .maybeSingle<{ workspace_id: string; role: string }>();
    if (memberError) {
      console.error('[auth-middleware] membership lookup failed:', memberError.message);
      throw new ApiError(500, 'Authentication temporarily unavailable.', 'auth_unavailable');
    }
    if (!data) {
      throw new ApiError(403, 'You are not a member of this workspace.', 'forbidden');
    }
    return { workspaceId: data.workspace_id, method: 'session', userId: user.id };
  }

  const { data, error: memberError } = await membershipQuery
    .order('created_at', { ascending: true })
    .limit(1)
    .returns<{ workspace_id: string; role: string }[]>();

  if (memberError) {
    console.error('[auth-middleware] membership lookup failed:', memberError.message);
    throw new ApiError(500, 'Authentication temporarily unavailable.', 'auth_unavailable');
  }
  const first = data?.[0];
  if (!first) {
    throw new ApiError(403, 'No workspace found for this user.', 'no_workspace');
  }
  return { workspaceId: first.workspace_id, method: 'session', userId: user.id };
}

function safeHashCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
