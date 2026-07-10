import { getServiceDb, type ConnectionRow } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/auth/encryption';
import { createAdapter } from '@/lib/adapters';
import { PlatformError, type TokenInfo } from '@/lib/adapters/types';

// Proactive refresh windows — refresh BEFORE expiry (Invariante 6).
// Bluesky/Mastodon/Telegram credentials never expire -> no entry.
const REFRESH_BUFFER_MS: Partial<Record<ConnectionRow['platform'], number>> = {
  linkedin: 7 * 24 * 60 * 60 * 1000, // token lives 60 days -> refresh 7 days early
  x: 30 * 60 * 1000, // token lives 2 HOURS -> refresh 30 min early
};

// Soft lock via compare-and-swap on refresh_locked_until.
// PostgREST cannot hold pg_advisory_xact_lock across the external refresh
// HTTP call (one transaction per query), so the CAS column IS the lock (R1).
const LOCK_DURATION_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_MAX_WAITS = 2;

export interface ValidToken {
  connection: ConnectionRow;
  token: TokenInfo;
}

export interface RefreshOutcome {
  refreshed: boolean;
  reason: 'refreshed' | 'not_refreshable' | 'not_due' | 'refreshed_elsewhere';
  expiresAt?: string;
}

export async function getValidToken(connectionId: string): Promise<ValidToken> {
  let connection = await loadConnection(connectionId);
  assertUsable(connection);

  if (needsRefresh(connection)) {
    connection = await refreshWithLock(connection);
    assertUsable(connection);
  }

  return { connection, token: buildTokenInfo(connection) };
}

// Used by the Inngest tokens/refresh function. force=true skips the due-check.
export async function refreshConnectionToken(
  connectionId: string,
  force = false
): Promise<RefreshOutcome> {
  const connection = await loadConnection(connectionId);
  assertUsable(connection);

  if (!(connection.platform in REFRESH_BUFFER_MS)) {
    return { refreshed: false, reason: 'not_refreshable' };
  }
  if (!force && !needsRefresh(connection)) {
    return { refreshed: false, reason: 'not_due', expiresAt: connection.token_expires_at ?? undefined };
  }

  const before = connection.token_expires_at;
  const after = await refreshWithLock(connection);
  const changed = after.token_expires_at !== before;
  return {
    refreshed: changed,
    reason: changed ? 'refreshed' : 'refreshed_elsewhere',
    expiresAt: after.token_expires_at ?? undefined,
  };
}

export function needsRefresh(connection: ConnectionRow): boolean {
  const buffer = REFRESH_BUFFER_MS[connection.platform];
  if (!buffer || !connection.token_expires_at) return false;
  return new Date(connection.token_expires_at).getTime() < Date.now() + buffer;
}

// Decrypts the connection's credentials into the adapter TokenInfo shape.
// Does NOT trigger a refresh — health checks test the token as-is.
export function buildTokenInfo(connection: ConnectionRow): TokenInfo {
  const config = connection.config ?? {};

  switch (connection.platform) {
    case 'linkedin':
    case 'x': {
      if (!connection.access_token_encrypted) {
        throw new PlatformError('AUTH_REVOKED', connection.platform, 'Connection has no access token');
      }
      return {
        accessToken: decrypt(connection.access_token_encrypted),
        refreshToken: connection.refresh_token_encrypted
          ? decrypt(connection.refresh_token_encrypted)
          : undefined,
        expiresAt: connection.token_expires_at ? new Date(connection.token_expires_at) : undefined,
      };
    }
    case 'mastodon': {
      if (!connection.access_token_encrypted) {
        throw new PlatformError('AUTH_REVOKED', 'mastodon', 'Connection has no access token');
      }
      const instanceUrl = typeof config.instance_url === 'string' ? config.instance_url : undefined;
      if (!instanceUrl) {
        throw new PlatformError('UNKNOWN', 'mastodon', 'Connection config is missing instance_url');
      }
      return {
        accessToken: decrypt(connection.access_token_encrypted),
        instanceUrl,
      };
    }
    case 'bluesky': {
      if (!connection.app_password_encrypted) {
        throw new PlatformError('AUTH_REVOKED', 'bluesky', 'Connection has no app password');
      }
      const identifier =
        typeof config.handle === 'string' ? config.handle : connection.account_name;
      return {
        accessToken: '',
        appPassword: decrypt(connection.app_password_encrypted),
        identifier,
      };
    }
    case 'telegram': {
      if (!connection.bot_token_encrypted) {
        throw new PlatformError('AUTH_REVOKED', 'telegram', 'Connection has no bot token');
      }
      const chatId =
        typeof config.chat_id === 'string' || typeof config.chat_id === 'number'
          ? String(config.chat_id)
          : undefined;
      return {
        accessToken: '',
        botToken: decrypt(connection.bot_token_encrypted),
        chatId,
      };
    }
  }
}

// ---------------------------------------------------------------
// Internals
// ---------------------------------------------------------------

async function loadConnection(connectionId: string): Promise<ConnectionRow> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('platform_connections')
    .select('*')
    .eq('id', connectionId)
    .maybeSingle<ConnectionRow>();

  if (error) {
    throw new Error(`[token-manager] failed to load connection ${connectionId}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`[token-manager] connection ${connectionId} not found`);
  }
  return data;
}

function assertUsable(connection: ConnectionRow): void {
  if (connection.status === 'active') return;
  const type = connection.status === 'expired' ? 'AUTH_EXPIRED' : 'AUTH_REVOKED';
  throw new PlatformError(
    type,
    connection.platform,
    `Connection is ${connection.status} — user must reconnect`
  );
}

async function refreshWithLock(connection: ConnectionRow): Promise<ConnectionRow> {
  const db = getServiceDb();
  const acquired = await tryAcquireLock(connection.id);

  if (!acquired) {
    // Another job is refreshing. Wait, then read the fresh token it wrote.
    for (let attempt = 0; attempt < LOCK_MAX_WAITS; attempt++) {
      await sleep(LOCK_WAIT_MS);
      const fresh = await loadConnection(connection.id);
      if (fresh.status !== 'active') {
        assertUsable(fresh); // throws
      }
      if (!needsRefresh(fresh)) {
        return fresh;
      }
    }
    throw new PlatformError(
      'UNKNOWN',
      connection.platform,
      'Token refresh is in progress in another job — retry later',
      true
    );
  }

  try {
    // Re-read under the lock: someone may have refreshed between our
    // initial read and the lock acquisition.
    const current = await loadConnection(connection.id);
    if (!needsRefresh(current)) {
      await releaseLock(connection.id);
      return current;
    }

    if (!current.refresh_token_encrypted) {
      await markConnectionExpired(current, 'No refresh token stored');
      throw new PlatformError(
        'AUTH_REVOKED',
        current.platform,
        'No refresh token available — user must reconnect'
      );
    }

    const adapter = createAdapter(current.platform);
    const refreshToken = decrypt(current.refresh_token_encrypted);
    const result = await adapter.refreshToken(refreshToken);

    // X returns a NEW single-use refresh token on every refresh — persist it
    // in the SAME write as the access token, before anything else can run.
    const update: Record<string, unknown> = {
      access_token_encrypted: encrypt(result.accessToken),
      token_expires_at: result.expiresAt.toISOString(),
      status: 'active',
      refresh_locked_until: null,
    };
    if (result.refreshToken) {
      update.refresh_token_encrypted = encrypt(result.refreshToken);
    }

    const { error: writeError } = await db
      .from('platform_connections')
      .update(update)
      .eq('id', current.id);
    if (writeError) {
      throw new Error(`[token-manager] token write failed: ${writeError.message}`);
    }

    // Double Assurance: read back and verify the new expiry landed.
    const verified = await loadConnection(current.id);
    if (verified.token_expires_at !== result.expiresAt.toISOString()) {
      throw new Error('[token-manager] token write verification failed');
    }
    return verified;
  } catch (error) {
    if (
      error instanceof PlatformError &&
      (error.type === 'AUTH_EXPIRED' || error.type === 'AUTH_REVOKED')
    ) {
      // Refresh token itself is dead -> connection is unrecoverable.
      await markConnectionExpired(connection, error.message);
      throw new PlatformError(
        'AUTH_REVOKED',
        connection.platform,
        'Refresh token rejected — user must reconnect'
      );
    }
    await releaseLock(connection.id);
    throw error;
  }
}

// Atomic compare-and-swap: only one concurrent caller gets a row back.
async function tryAcquireLock(connectionId: string): Promise<boolean> {
  const db = getServiceDb();
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('platform_connections')
    .update({ refresh_locked_until: new Date(Date.now() + LOCK_DURATION_MS).toISOString() })
    .eq('id', connectionId)
    .or(`refresh_locked_until.is.null,refresh_locked_until.lt.${nowIso}`)
    .select('id');

  if (error) {
    throw new Error(`[token-manager] lock acquisition failed: ${error.message}`);
  }
  return (data ?? []).length === 1;
}

async function releaseLock(connectionId: string): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('platform_connections')
    .update({ refresh_locked_until: null })
    .eq('id', connectionId);
  if (error) {
    // Lock expires on its own after 30s — log, don't throw.
    console.error(`[token-manager] lock release failed for ${connectionId}: ${error.message}`);
  }
}

// Marks a connection dead and fails its pending posts. Exported for the
// health-check job, which detects revoked tokens outside a refresh.
export async function markConnectionExpired(connection: ConnectionRow, reason: string): Promise<void> {
  const db = getServiceDb();
  console.error(
    `[token-manager] connection ${connection.id} (${connection.platform}) expired: ${reason}`
  );

  const { error } = await db
    .from('platform_connections')
    .update({ status: 'expired', refresh_locked_until: null })
    .eq('id', connection.id);
  if (error) {
    console.error(`[token-manager] failed to mark connection expired: ${error.message}`);
  }

  // Pending posts can never publish on a dead token — fail them now with a
  // clear message instead of letting them error days later (FABLE-01).
  const { error: postsError } = await db
    .from('post_items')
    .update({
      status: 'failed',
      error_message: 'Token expired — reconnect required',
    })
    .eq('connection_id', connection.id)
    .in('status', ['queued', 'scheduled']);
  if (postsError) {
    console.error(`[token-manager] failed to fail pending posts: ${postsError.message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
