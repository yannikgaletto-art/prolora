import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { getServiceDb, type BoardItemRow } from '@/lib/db';
import { ApiError } from '@/lib/api/http';
import { inngest } from '@/lib/inngest/client';

const PAGE_SIZE = 50;
const SUBMISSIONS_PER_HOUR_LIMIT = 20;

// Public column allowlist (Invariante 2): anonymous board visitors must NEVER
// see submitted_by_email, customer_mrr, customer_tier or linked_feedback_ids.
const PUBLIC_BOARD_ITEM_COLUMNS =
  'id, title, description, vote_count, status, category, created_at, shipped_at, submitted_by_name';

export type PublicBoardItem = Pick<
  BoardItemRow,
  | 'id'
  | 'title'
  | 'description'
  | 'vote_count'
  | 'status'
  | 'category'
  | 'created_at'
  | 'shipped_at'
  | 'submitted_by_name'
>;

export type BoardItemStatus = BoardItemRow['status'];

export const BOARD_ITEM_STATUSES = [
  'open',
  'planned',
  'in_progress',
  'shipped',
  'declined',
] as const;

export const submitBoardItemSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional(),
  category: z.string().max(100).optional(),
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
});

export type SubmitBoardItemInput = z.infer<typeof submitBoardItemSchema>;

export interface PublicBoardItemsPage {
  items: PublicBoardItem[];
  page: number;
  per_page: number;
  total: number;
}

// SHA-256 fingerprint of (ip + user-agent) — stable per anonymous visitor,
// no raw IP ever stored.
export function requestFingerprint(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  const userAgent = req.headers.get('user-agent') ?? '';
  return createHash('sha256').update(ip + userAgent).digest('hex');
}

async function resolveWorkspaceBySlug(workspaceSlug: string): Promise<{ id: string; slug: string }> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspaces')
    .select('id, slug')
    .eq('slug', workspaceSlug)
    .maybeSingle<{ id: string; slug: string }>();
  if (error) {
    throw new Error(`[board] workspace lookup failed: ${error.message}`);
  }
  if (!data) {
    throw new ApiError(404, 'Board not found.', 'board_not_found');
  }
  return data;
}

// Public read: paginated, ordered by votes then recency, allowlisted columns only.
export async function getPublicBoardItems(
  workspaceSlug: string,
  page = 1
): Promise<PublicBoardItemsPage> {
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);
  const db = getServiceDb();

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await db
    .from('board_items')
    .select(PUBLIC_BOARD_ITEM_COLUMNS, { count: 'exact' })
    .eq('workspace_id', workspace.id)
    .order('vote_count', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)
    .returns<PublicBoardItem[]>();

  if (error) {
    throw new Error(`[board] items query failed: ${error.message}`);
  }

  return { items: data ?? [], page, per_page: PAGE_SIZE, total: count ?? 0 };
}

// Public submission — DB-side rate limit (COUNT over the last hour, never
// in-memory) then insert with status 'open'.
export async function submitBoardItem(
  workspaceSlug: string,
  input: SubmitBoardItemInput,
  fingerprint: string
): Promise<PublicBoardItem> {
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);
  const db = getServiceDb();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await db
    .from('board_items')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace.id)
    .gt('created_at', oneHourAgo);
  if (countError) {
    throw new Error(`[board] rate-limit count failed: ${countError.message}`);
  }
  if ((count ?? 0) >= SUBMISSIONS_PER_HOUR_LIMIT) {
    throw new ApiError(
      429,
      'Too many submissions to this board. Please try again later.',
      'rate_limited'
    );
  }

  const { data: item, error: insertError } = await db
    .from('board_items')
    .insert({
      workspace_id: workspace.id,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      submitted_by_email: input.email ?? null,
      submitted_by_name: input.name ?? null,
      status: 'open',
      vote_count: 0,
    })
    .select(PUBLIC_BOARD_ITEM_COLUMNS)
    .single<PublicBoardItem>();
  if (insertError || !item) {
    throw new Error(`[board] item insert failed: ${insertError?.message ?? 'no row returned'}`);
  }

  console.log(
    `[board] item created ${item.id} for workspace ${workspace.slug} (fingerprint ${fingerprint.slice(0, 12)}…)`
  );
  return item;
}

// Public vote — unique (board_item_id, voter_fingerprint) enforced by the DB;
// duplicate votes surface as 409, never as a crash.
export async function voteBoardItem(
  workspaceSlug: string,
  boardItemId: string,
  fingerprint: string,
  voterEmail?: string
): Promise<{ vote_count: number }> {
  const workspace = await resolveWorkspaceBySlug(workspaceSlug);
  const db = getServiceDb();

  // Item must belong to this workspace (Invariante 2).
  const { data: item, error: itemError } = await db
    .from('board_items')
    .select('id, vote_count')
    .eq('id', boardItemId)
    .eq('workspace_id', workspace.id)
    .maybeSingle<{ id: string; vote_count: number }>();
  if (itemError) {
    throw new Error(`[board] item lookup failed: ${itemError.message}`);
  }
  if (!item) {
    throw new ApiError(404, 'Board item not found.', 'board_item_not_found');
  }

  const { error: voteError } = await db.from('board_votes').insert({
    board_item_id: item.id,
    voter_fingerprint: fingerprint,
    voter_email: voterEmail ?? null,
  });
  if (voteError) {
    if (voteError.code === '23505') {
      throw new ApiError(409, 'You have already voted for this item.', 'already_voted');
    }
    throw new Error(`[board] vote insert failed: ${voteError.message}`);
  }

  // Read-modify-write is acceptable here (best-effort counter, votes are the
  // source of truth via board_votes).
  const newCount = item.vote_count + 1;
  const { error: updateError } = await db
    .from('board_items')
    .update({ vote_count: newCount })
    .eq('id', item.id)
    .eq('workspace_id', workspace.id);
  if (updateError) {
    throw new Error(`[board] vote_count update failed: ${updateError.message}`);
  }

  console.log(`[board] vote recorded for item ${item.id} in workspace ${workspace.slug} (count ${newCount})`);
  return { vote_count: newCount };
}

// Authenticated status change — scoped by the caller's verified workspaceId.
// Transition to 'shipped' stamps shipped_at and notifies voters via Inngest.
export async function updateBoardItemStatus(
  workspaceId: string,
  itemId: string,
  newStatus: BoardItemStatus
): Promise<PublicBoardItem> {
  const db = getServiceDb();

  const { data: item, error: itemError } = await db
    .from('board_items')
    .select('id, status')
    .eq('id', itemId)
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ id: string; status: BoardItemStatus }>();
  if (itemError) {
    throw new Error(`[board] item lookup failed: ${itemError.message}`);
  }
  if (!item) {
    throw new ApiError(404, 'Board item not found.', 'board_item_not_found');
  }

  const shippedTransition = newStatus === 'shipped' && item.status !== 'shipped';
  const { data: updated, error: updateError } = await db
    .from('board_items')
    .update({
      status: newStatus,
      ...(shippedTransition ? { shipped_at: new Date().toISOString() } : {}),
    })
    .eq('id', item.id)
    .eq('workspace_id', workspaceId)
    .select(PUBLIC_BOARD_ITEM_COLUMNS)
    .single<PublicBoardItem>();
  if (updateError || !updated) {
    throw new Error(`[board] status update failed: ${updateError?.message ?? 'no row returned'}`);
  }

  if (shippedTransition) {
    await inngest.send({
      name: 'board/notify-voters',
      data: { boardItemId: item.id, newStatus },
    });
  }

  console.log(`[board] item ${item.id} status ${item.status} -> ${newStatus}`);
  return updated;
}

// --- F5 additions (admin + public board pages) ---

// Authenticated admin read (F5-1): full internal columns — this is only ever
// called from a workspace-scoped Server Component, so submitted_by_email /
// customer_mrr / customer_tier / linked_feedback_ids (withheld from the
// public allowlist above) are fine to return here.
export async function getAllBoardItemsForWorkspace(workspaceId: string): Promise<BoardItemRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('board_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .returns<BoardItemRow[]>();
  if (error) {
    throw new Error(`[board] admin list failed: ${error.message}`);
  }
  return data ?? [];
}

export type BoardSort = 'votes' | 'new';

export interface PublicBoardItemsFilteredPage extends PublicBoardItemsPage {
  workspaceName: string;
}

// Public read for the public board page (F5-3): getPublicBoardItems always
// orders by votes then recency and never filters by status. The public page
// needs a sort toggle and status tabs, plus the workspace display name (the
// public allowlist never carries workspace_id), so this resolves all three
// in one round trip rather than bolting filtering onto the existing export.
export async function getPublicBoardItemsFiltered(
  workspaceSlug: string,
  opts: { page?: number; sort?: BoardSort; status?: BoardItemStatus } = {}
): Promise<PublicBoardItemsFilteredPage> {
  const { page = 1, sort = 'votes', status } = opts;
  const db = getServiceDb();

  const { data: workspace, error: wsError } = await db
    .from('workspaces')
    .select('id, name')
    .eq('slug', workspaceSlug)
    .maybeSingle<{ id: string; name: string }>();
  if (wsError) {
    throw new Error(`[board] workspace lookup failed: ${wsError.message}`);
  }
  if (!workspace) {
    throw new ApiError(404, 'Board not found.', 'board_not_found');
  }

  const from = (page - 1) * PAGE_SIZE;
  let query = db
    .from('board_items')
    .select(PUBLIC_BOARD_ITEM_COLUMNS, { count: 'exact' })
    .eq('workspace_id', workspace.id);

  if (status) {
    query = query.eq('status', status);
  }
  query =
    sort === 'new'
      ? query.order('created_at', { ascending: false })
      : query.order('vote_count', { ascending: false }).order('created_at', { ascending: false });

  const { data, count, error } = await query
    .range(from, from + PAGE_SIZE - 1)
    .returns<PublicBoardItem[]>();
  if (error) {
    throw new Error(`[board] filtered items query failed: ${error.message}`);
  }

  return {
    items: data ?? [],
    page,
    per_page: PAGE_SIZE,
    total: count ?? 0,
    workspaceName: workspace.name,
  };
}
