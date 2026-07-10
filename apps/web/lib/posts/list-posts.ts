import { getServiceDb, type PostGroupRow, type PostItemRow } from '@/lib/db';
import type { PlatformType, PostStatus } from '@prolora/shared';

// New lib file (F1 Publish). Mirrors the exact filter/pagination logic of
// GET /api/v1/posts (app/api/v1/posts/route.ts) so the /publish/posts Server
// Component can read post_groups + post_items without fetch()-ing our own API.

export interface PostGroupWithItems extends PostGroupRow {
  post_items: PostItemRow[];
}

export interface ListPostsFilters {
  status?: PostStatus;
  platform?: PlatformType;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}

export interface ListPostsResult {
  posts: PostGroupWithItems[];
  page: number;
  perPage: number;
  total: number;
}

export async function getPostGroups(
  workspaceId: string,
  filters: ListPostsFilters = {}
): Promise<ListPostsResult> {
  const db = getServiceDb();
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const perPage =
    filters.perPage && filters.perPage > 0 ? Math.min(Math.floor(filters.perPage), 100) : 25;

  // Same trick as the API route: only INNER join post_items when a filter
  // actually needs to constrain on them, otherwise groups with zero matching
  // items would silently disappear from an outer-joined result set.
  const needsItemFilter = Boolean(filters.status || filters.platform);
  let builder = db
    .from('post_groups')
    .select(needsItemFilter ? '*, post_items!inner(*)' : '*, post_items(*)', { count: 'exact' })
    .eq('workspace_id', workspaceId);

  if (filters.status) builder = builder.eq('post_items.status', filters.status);
  if (filters.platform) builder = builder.eq('post_items.platform', filters.platform);
  if (filters.dateFrom) builder = builder.gte('created_at', filters.dateFrom);
  if (filters.dateTo) builder = builder.lte('created_at', filters.dateTo);

  const from = (page - 1) * perPage;
  const { data, count, error } = await builder
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)
    .returns<PostGroupWithItems[]>();

  if (error) {
    throw new Error(`[list-posts] query failed: ${error.message}`);
  }

  return { posts: data ?? [], page, perPage, total: count ?? 0 };
}
