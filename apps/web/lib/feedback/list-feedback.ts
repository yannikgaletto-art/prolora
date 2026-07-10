import { getServiceDb, type FeedbackItemRow } from '@/lib/db';
import type { FeedbackCategory, FeedbackSentiment, FeedbackUrgency } from '@prolora/shared';

// Read path for Server Components (F2 - Listen). Mirrors the query built by
// GET /api/v1/feedback (app/api/v1/feedback/route.ts) field-for-field —
// same filters, same ordering, same pagination math, same embedding strip —
// but talks to the DB directly instead of round-tripping through our own API
// route (Oracle 5: Server Components never fetch() themselves).

export type FeedbackListItem = Omit<FeedbackItemRow, 'embedding'>;

export interface FeedbackListFilters {
  platform?: string;
  sentiment?: FeedbackSentiment;
  category?: FeedbackCategory;
  urgency?: FeedbackUrgency;
  is_duplicate?: boolean;
  date_from?: string;
  date_to?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export interface FeedbackListResult {
  items: FeedbackListItem[];
  page: number;
  per_page: number;
  total: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

export async function getFeedbackItems(
  workspaceId: string,
  filters: FeedbackListFilters = {}
): Promise<FeedbackListResult> {
  const page =
    filters.page && Number.isFinite(filters.page) && filters.page > 0
      ? Math.floor(filters.page)
      : DEFAULT_PAGE;
  const perPage =
    filters.per_page && Number.isFinite(filters.per_page)
      ? Math.min(Math.max(Math.floor(filters.per_page), 1), MAX_PER_PAGE)
      : DEFAULT_PER_PAGE;

  const db = getServiceDb();
  let builder = db
    .from('feedback_items')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId);

  if (filters.platform) builder = builder.eq('source_platform', filters.platform);
  if (filters.sentiment) builder = builder.eq('sentiment', filters.sentiment);
  if (filters.category) builder = builder.eq('category', filters.category);
  if (filters.urgency) builder = builder.eq('urgency', filters.urgency);
  if (filters.is_duplicate !== undefined) builder = builder.eq('is_duplicate', filters.is_duplicate);
  if (filters.date_from) builder = builder.gte('created_at', filters.date_from);
  if (filters.date_to) builder = builder.lte('created_at', filters.date_to);
  if (filters.search) {
    const term = filters.search.replace(/[%_,()]/g, ' ').trim();
    if (term) {
      builder = builder.or(
        `original_content.ilike.%${term}%,summary_en.ilike.%${term}%,summary_de.ilike.%${term}%`
      );
    }
  }

  const from = (page - 1) * perPage;
  const { data, count, error } = await builder
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)
    .returns<FeedbackItemRow[]>();

  if (error) {
    throw new Error(`[feedback] list query failed: ${error.message}`);
  }

  // embedding is an internal vector — strip it, same as the API route.
  const items = (data ?? []).map(({ embedding: _embedding, ...rest }) => rest);

  return { items, page, per_page: perPage, total: count ?? 0 };
}
