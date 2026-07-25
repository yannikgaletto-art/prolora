// "How many posts may this channel still take today?"
//
// `platform_connections.rate_limit_state` has existed since the first schema and
// is written after every publish (lib/inngest/functions/publish-post.ts), but
// only ever read *reactively* — to decide whether the job that is already
// running has to sleep. Planning needs the same number up front, which is what
// this module exposes.
//
// Two independent ceilings apply and the tighter one wins:
//   1. the platform's documented per-day cap for a single account, and
//   2. the live budget the platform reported in its last response headers.
// A channel whose token is gone has no capacity at all regardless of either,
// so token state is checked first — an expired token is a harder block than an
// exhausted quota, and saying "3 posts left" about a dead channel would be a
// lie the scheduler acts on.
//
// Platforms without a published per-account daily cap return `null`
// (= unbounded here) instead of an invented number.

import { CONNECTION_ROW_COLUMNS, getServiceDb, type ConnectionRow } from '@/lib/db';
import { classifyConnectionHealth } from './health';

export interface ChannelCapacity {
  connectionId: string;
  platform: string;
  remainingToday: number | null; // null = unbegrenzt
  nextResetAt: string | null;
  blocked: boolean;
  blockedReason: 'rate_limited' | 'token_expired' | 'revoked' | null;
}

/**
 * Documented per-account posting caps per 24h. `null` = the platform publishes
 * no per-account daily cap (only burst limits), so we do not pretend to know one.
 */
export const PLATFORM_DAILY_POST_LIMITS: Record<ConnectionRow['platform'], number | null> = {
  linkedin: 150, // UGC Posts: 150 per member per day
  x: 100, // POST /2/tweets: 100 per user per 24h
  bluesky: null,
  mastodon: null,
  telegram: null,
  discord: null,
  devto: null,
  hashnode: null,
};

interface RateLimitState {
  remaining: number | null;
  resetAt: string | null;
}

// Written by publish-post as { remaining, limit, reset_at }. Anything else in
// the JSONB column is treated as "no information" rather than trusted blindly.
function readRateLimitState(row: ConnectionRow): RateLimitState {
  const state = row.rate_limit_state;
  if (!state) return { remaining: null, resetAt: null };
  return {
    remaining: typeof state.remaining === 'number' ? state.remaining : null,
    resetAt: typeof state.reset_at === 'string' ? state.reset_at : null,
  };
}

/** Midnight UTC after `now` — when a per-day counter starts over. */
export function nextDailyReset(now: Date): string {
  const reset = new Date(now);
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
}

/** Start of the current UTC day — the window `publishedToday` is counted over. */
export function dailyWindowStart(now: Date): string {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Pure core so the arithmetic is testable without a database.
 * `publishedToday` = post_items already published on this connection today.
 */
export function computeChannelCapacity(
  row: ConnectionRow,
  publishedToday: number,
  now: Date = new Date()
): ChannelCapacity {
  const health = classifyConnectionHealth(row, now);

  if (health.state === 'revoked') {
    return {
      connectionId: row.id,
      platform: row.platform,
      remainingToday: 0,
      nextResetAt: null,
      blocked: true,
      blockedReason: 'revoked',
    };
  }
  if (health.state === 'expired') {
    return {
      connectionId: row.id,
      platform: row.platform,
      remainingToday: 0,
      nextResetAt: null,
      blocked: true,
      blockedReason: 'token_expired',
    };
  }

  const dailyLimit = PLATFORM_DAILY_POST_LIMITS[row.platform] ?? null;
  const fromDailyLimit = dailyLimit === null ? null : Math.max(dailyLimit - publishedToday, 0);

  const { remaining, resetAt } = readRateLimitState(row);
  // A reset that already passed means the reported budget is stale: the window
  // rolled over and the platform will hand out a fresh allowance.
  const budgetIsCurrent = resetAt !== null && new Date(resetAt).getTime() > now.getTime();
  const fromBudget = budgetIsCurrent && remaining !== null ? Math.max(remaining, 0) : null;

  let remainingToday: number | null;
  if (fromDailyLimit === null) remainingToday = fromBudget;
  else if (fromBudget === null) remainingToday = fromDailyLimit;
  else remainingToday = Math.min(fromDailyLimit, fromBudget);

  const budgetIsBinding = fromBudget !== null && (fromDailyLimit === null || fromBudget <= fromDailyLimit);
  const nextResetAt =
    remainingToday === null
      ? null
      : budgetIsBinding && resetAt
        ? resetAt
        : nextDailyReset(now);

  const blocked = remainingToday !== null && remainingToday <= 0;
  return {
    connectionId: row.id,
    platform: row.platform,
    remainingToday,
    nextResetAt,
    blocked,
    blockedReason: blocked ? 'rate_limited' : null,
  };
}

/**
 * Invariante 2: connections are read with an explicit workspace_id filter, and
 * the post_items count is scoped to exactly those connection ids — post_items
 * itself carries no workspace_id column, so the id list *is* the scope.
 */
export async function getChannelCapacity(workspaceId: string): Promise<ChannelCapacity[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('platform_connections')
    .select(CONNECTION_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .returns<ConnectionRow[]>();

  if (error) {
    throw new Error(`[connections:capacity] query failed: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const now = new Date();
  const publishedToday = await countPublishedToday(
    rows.map((row) => row.id),
    now
  );

  return rows.map((row) => computeChannelCapacity(row, publishedToday.get(row.id) ?? 0, now));
}

async function countPublishedToday(
  connectionIds: string[],
  now: Date
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_items')
    .select('connection_id')
    .in('connection_id', connectionIds)
    .eq('status', 'published')
    .gte('published_at', dailyWindowStart(now))
    .returns<Array<{ connection_id: string }>>();

  if (error) {
    // Capacity is advisory: a failed count must not take the page down. The
    // daily cap then reads as "nothing used yet", which the live rate-limit
    // budget still corrects downwards.
    console.error(`[connections:capacity] published-today count failed: ${error.message}`);
    return counts;
  }

  for (const row of data ?? []) {
    counts.set(row.connection_id, (counts.get(row.connection_id) ?? 0) + 1);
  }
  return counts;
}
