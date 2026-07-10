'use server';

// F6 Settings: api_keys has no app/api/v1 route (recon confirmed). Rather than
// build UI on top of a route that doesn't exist, these run as Next.js Server
// Actions straight against the service-role db — same effect as a route
// handler, no new route file. generateApiKey()/hashApiKey() are the exact
// helpers app/api's auth-middleware.ts expects on the read side, reused
// verbatim so a key minted here authenticates correctly against the real API.

import { getServiceDb } from '@/lib/db';
import { generateApiKey } from '@/lib/auth/encryption';
import { assertOwnWorkspace } from './workspace-guard';

export interface ApiKeySummary {
  id: string;
  name: string | null;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const SUMMARY_COLUMNS = 'id, name, key_prefix, created_at, last_used_at, revoked_at';

export async function listApiKeys(workspaceId: string): Promise<ApiKeySummary[]> {
  const wsId = await assertOwnWorkspace(workspaceId);
  const db = getServiceDb();
  const { data, error } = await db
    .from('api_keys')
    .select(SUMMARY_COLUMNS)
    .eq('workspace_id', wsId)
    .order('created_at', { ascending: false })
    .returns<ApiKeySummary[]>();
  if (error) {
    throw new Error(`[settings/api-keys] list failed: ${error.message}`);
  }
  return data ?? [];
}

// Returns the raw key exactly once — the caller is responsible for showing it
// to the user a single time and never persisting it client-side beyond that.
export async function createApiKey(
  workspaceId: string,
  name: string
): Promise<{ key: string; apiKey: ApiKeySummary }> {
  const wsId = await assertOwnWorkspace(workspaceId);
  const trimmed = name.trim().slice(0, 100);
  if (!trimmed) {
    throw new Error('Name is required.');
  }

  const { key, prefix, hash } = generateApiKey();
  const db = getServiceDb();
  const { data, error } = await db
    .from('api_keys')
    .insert({ workspace_id: wsId, key_hash: hash, key_prefix: prefix, name: trimmed })
    .select(SUMMARY_COLUMNS)
    .single<ApiKeySummary>();
  if (error || !data) {
    throw new Error(`[settings/api-keys] create failed: ${error?.message ?? 'no row returned'}`);
  }

  return { key, apiKey: data };
}

export async function revokeApiKey(workspaceId: string, keyId: string): Promise<void> {
  const wsId = await assertOwnWorkspace(workspaceId);
  const db = getServiceDb();
  const { error } = await db
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('workspace_id', wsId);
  if (error) {
    throw new Error(`[settings/api-keys] revoke failed: ${error.message}`);
  }
}
