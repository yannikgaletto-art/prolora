import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getServiceDb, type OpportunityThreadRow } from '@/lib/db';

const listQuerySchema = z.object({
  status: z.enum(['new', 'drafted', 'posted', 'skipped', 'expired']).optional(),
  community: z.string().max(100).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/v1/discover/opportunities — the opportunity feed
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const db = getServiceDb();
    let builder = db
      .from('opportunity_threads')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId);

    if (query.status) builder = builder.eq('status', query.status);
    if (query.community) builder = builder.eq('community_name', query.community);
    if (query.date_from) builder = builder.gte('created_at', query.date_from);
    if (query.date_to) builder = builder.lte('created_at', query.date_to);

    const from = (query.page - 1) * query.per_page;
    const { data, count, error } = await builder
      .order('relevance_score', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + query.per_page - 1)
      .returns<OpportunityThreadRow[]>();
    if (error) {
      throw new Error(`[discover/opportunities] query failed: ${error.message}`);
    }

    return NextResponse.json({
      opportunities: data ?? [],
      page: query.page,
      per_page: query.per_page,
      total: count ?? 0,
    });
  } catch (error) {
    return handleRouteError('v1/discover/opportunities GET', error);
  }
}
