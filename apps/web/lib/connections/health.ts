// Channel health as a *classification*, deliberately separate from the live
// probe in lib/inngest/functions/token-lifecycle.ts.
//
// `tokenHealthCheck` already calls every platform every six hours and writes
// `last_health_check`. What it does not do is turn that into something a person
// or a scheduler can act on: it only knows "the token answered / it did not".
// This module reads what is already in the row — status, token_expires_at,
// last_health_check — and derives the four states the UI shows and the capacity
// layer blocks on. No network calls, so it is safe to run on every page render
// and in a daily cron alike.
//
// `previousState` is the state implied by the coarse `status` column alone.
// Comparing against it is what makes a change detectable without a new column:
// the classifier only ever "knows more" than status (a token that is about to
// expire, or one that already did while status still says active), so a
// divergence is exactly the moment something changed that nobody has acted on.

import { CONNECTION_ROW_COLUMNS, getServiceDb, type ConnectionRow } from '@/lib/db';

export type ConnectionHealthState = 'healthy' | 'expiring_soon' | 'expired' | 'revoked';

/** How far ahead a token expiry is worth warning about. */
export const EXPIRY_WARNING_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConnectionHealth {
  connectionId: string;
  workspaceId: string;
  platform: string;
  accountName: string;
  state: ConnectionHealthState;
  /** State implied by `status` alone — the baseline for change detection. */
  previousState: ConnectionHealthState;
  tokenExpiresAt: string | null;
  /** Whole days until expiry (negative when already past). null = never expires. */
  expiresInDays: number | null;
  /** A refresh token exists, so the fix may not need the user at all. */
  canAutoRefresh: boolean;
  lastCheckedAt: string | null;
  /** Result of the last live probe: true/false, or null when never checked. */
  lastCheckOk: boolean | null;
}

/** The coarse view the `status` column carries on its own. */
export function stateFromStatus(status: ConnectionRow['status']): ConnectionHealthState {
  if (status === 'revoked') return 'revoked';
  if (status === 'expired' || status === 'error') return 'expired';
  return 'healthy';
}

function readLastCheck(row: ConnectionRow): { checkedAt: string | null; ok: boolean | null } {
  const check = row.last_health_check;
  if (!check) return { checkedAt: null, ok: null };
  const checkedAt = typeof check.checked_at === 'string' ? check.checked_at : null;
  const ok = typeof check.ok === 'boolean' ? check.ok : null;
  return { checkedAt, ok };
}

export function classifyConnectionHealth(
  row: ConnectionRow,
  now: Date = new Date()
): ConnectionHealth {
  const { checkedAt, ok } = readLastCheck(row);
  const expiresAtMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  const validExpiry = expiresAtMs !== null && Number.isFinite(expiresAtMs) ? expiresAtMs : null;
  const msLeft = validExpiry === null ? null : validExpiry - now.getTime();

  let state: ConnectionHealthState;
  if (row.status === 'revoked') {
    state = 'revoked';
  } else if (row.status === 'expired' || row.status === 'error') {
    state = 'expired';
  } else if (ok === false) {
    // The live probe got a 401/403 — the row may not have caught up yet.
    state = 'expired';
  } else if (msLeft !== null && msLeft <= 0) {
    state = 'expired';
  } else if (msLeft !== null && msLeft <= EXPIRY_WARNING_DAYS * DAY_MS) {
    state = 'expiring_soon';
  } else {
    state = 'healthy';
  }

  return {
    connectionId: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    accountName: row.account_name,
    state,
    previousState: stateFromStatus(row.status),
    tokenExpiresAt: row.token_expires_at,
    expiresInDays: msLeft === null ? null : Math.floor(msLeft / DAY_MS),
    canAutoRefresh: Boolean(row.refresh_token_encrypted),
    lastCheckedAt: checkedAt,
    lastCheckOk: ok,
  };
}

/** True when the existing refresh pipeline can plausibly fix this by itself. */
export function shouldRequestRefresh(health: ConnectionHealth): boolean {
  if (!health.canAutoRefresh) return false;
  if (health.state === 'revoked' || health.state === 'healthy') return false;
  return health.previousState !== 'revoked';
}

// Invariante 2: service-role read, always with an explicit workspace_id filter
// and the column allowlist rather than select('*').
export async function getConnectionHealth(workspaceId: string): Promise<ConnectionHealth[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('platform_connections')
    .select(CONNECTION_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .returns<ConnectionRow[]>();

  if (error) {
    throw new Error(`[connections:health] query failed: ${error.message}`);
  }

  const now = new Date();
  return (data ?? []).map((row) => classifyConnectionHealth(row, now));
}
