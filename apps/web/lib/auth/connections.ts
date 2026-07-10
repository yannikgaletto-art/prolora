import { getServiceDb, type ConnectionRow } from '@/lib/db';
import type { Connection, PlatformType } from '@prolora/shared';

// Public DTO — never exposes encrypted fields or raw config.
export function toConnectionDto(row: ConnectionRow): Connection {
  return {
    connection_id: row.id,
    platform: row.platform,
    account_name: row.account_name,
    account_type: (row.account_type ?? 'personal') as Connection['account_type'],
    avatar_url: row.avatar_url ?? undefined,
    connected_at: row.created_at,
    status: row.status,
  };
}

export interface SaveConnectionInput {
  workspaceId: string;
  platform: PlatformType;
  accountName: string;
  accountId: string;
  accountType?: string;
  avatarUrl?: string | null;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  tokenExpiresAt?: Date | null;
  appPasswordEncrypted?: string | null;
  botTokenEncrypted?: string | null;
  scopes?: string[];
  config?: Record<string, unknown>;
}

// Upsert by (workspace_id, platform, account_id): reconnecting an account
// replaces its credentials instead of creating a duplicate row.
// Double Assurance: write -> read-back -> verify (FABLE-03).
export async function saveConnection(input: SaveConnectionInput): Promise<ConnectionRow> {
  const db = getServiceDb();

  const payload: Record<string, unknown> = {
    workspace_id: input.workspaceId,
    platform: input.platform,
    account_name: input.accountName,
    account_id: input.accountId,
    account_type: input.accountType ?? 'personal',
    avatar_url: input.avatarUrl ?? null,
    access_token_encrypted: input.accessTokenEncrypted ?? null,
    refresh_token_encrypted: input.refreshTokenEncrypted ?? null,
    token_expires_at: input.tokenExpiresAt ? input.tokenExpiresAt.toISOString() : null,
    app_password_encrypted: input.appPasswordEncrypted ?? null,
    bot_token_encrypted: input.botTokenEncrypted ?? null,
    scopes: input.scopes ?? null,
    status: 'active',
    config: input.config ?? {},
    refresh_locked_until: null,
  };

  const { data: existing, error: lookupError } = await db
    .from('platform_connections')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('platform', input.platform)
    .eq('account_id', input.accountId)
    .maybeSingle<{ id: string }>();

  if (lookupError) {
    throw new Error(`[connections] lookup failed: ${lookupError.message}`);
  }

  let connectionId: string;
  if (existing) {
    const { error } = await db
      .from('platform_connections')
      .update(payload)
      .eq('id', existing.id);
    if (error) throw new Error(`[connections] update failed: ${error.message}`);
    connectionId = existing.id;
  } else {
    const { data: inserted, error } = await db
      .from('platform_connections')
      .insert(payload)
      .select('id')
      .single<{ id: string }>();
    if (error || !inserted) {
      throw new Error(`[connections] insert failed: ${error?.message ?? 'no row returned'}`);
    }
    connectionId = inserted.id;
  }

  // Read-back: verify the row exists, is active, and the stored credential
  // is NOT plaintext (Invariante 1 — encrypted values carry the version prefix).
  const { data: verified, error: verifyError } = await db
    .from('platform_connections')
    .select('*')
    .eq('id', connectionId)
    .single<ConnectionRow>();

  if (verifyError || !verified) {
    throw new Error(`[connections] write verification failed: ${verifyError?.message ?? 'row missing'}`);
  }
  if (verified.status !== 'active') {
    throw new Error('[connections] write verification failed: status is not active');
  }
  const storedSecret =
    verified.access_token_encrypted ?? verified.app_password_encrypted ?? verified.bot_token_encrypted;
  if (storedSecret && !/^v\d+:/.test(storedSecret)) {
    throw new Error('[connections] write verification failed: credential not encrypted');
  }

  return verified;
}
