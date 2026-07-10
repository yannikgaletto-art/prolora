import { getServiceDb, type OpportunityThreadRow } from '@/lib/db';

// Server Component read path (F0-4, Pfad A) for the Opportunities feed —
// mirrors the query in app/api/v1/discover/opportunities/route.ts GET
// (same filters, same ordering: relevance_score desc, then created_at desc),
// but is called directly from Server Components instead of over fetch().

export interface OpportunityFilters {
  status?: OpportunityThreadRow['status'];
  community?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}

export interface OpportunityListResult {
  opportunities: OpportunityThreadRow[];
  page: number;
  perPage: number;
  total: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;

export async function getOpportunities(
  workspaceId: string,
  filters: OpportunityFilters = {}
): Promise<OpportunityListResult> {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : DEFAULT_PAGE;
  const perPage =
    filters.perPage && filters.perPage > 0
      ? Math.min(Math.floor(filters.perPage), MAX_PER_PAGE)
      : DEFAULT_PER_PAGE;

  const db = getServiceDb();
  let builder = db
    .from('opportunity_threads')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId);

  if (filters.status) builder = builder.eq('status', filters.status);
  if (filters.community) builder = builder.eq('community_name', filters.community);
  if (filters.dateFrom) builder = builder.gte('created_at', filters.dateFrom);
  if (filters.dateTo) builder = builder.lte('created_at', filters.dateTo);

  const from = (page - 1) * perPage;
  const { data, count, error } = await builder
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, from + perPage - 1)
    .returns<OpportunityThreadRow[]>();
  if (error) {
    throw new Error(`[list-opportunities] query failed: ${error.message}`);
  }

  return { opportunities: data ?? [], page, perPage, total: count ?? 0 };
}
