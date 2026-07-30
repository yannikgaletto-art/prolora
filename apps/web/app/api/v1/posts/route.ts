import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createPostSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { createPost } from '@/lib/posts/create-post';
import { getServiceDb } from '@/lib/db';

// POST /api/v1/posts — create + distribute a post
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const request = createPostSchema.parse(body);
    const { response, warnings } = await createPost(workspaceId, request, 'api');

    return NextResponse.json(
      { ...response, ...(warnings.length > 0 ? { warnings } : {}) },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError('v1/posts POST', error);
  }
}

const listQuerySchema = z.object({
  status: z
    .enum([
      'queued',
      'scheduled',
      'publishing',
      'published',
      'failed',
      'reconciliation_required',
      'deleted',
    ])
    .optional(),
  platform: z.enum(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']).optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

// GET /api/v1/posts — paginated list with filters
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const db = getServiceDb();
    const needsItemFilter = Boolean(query.status || query.platform);
    let builder = db
      .from('post_groups')
      .select(needsItemFilter ? '*, post_items!inner(*)' : '*, post_items(*)', {
        count: 'exact',
      })
      .eq('workspace_id', workspaceId);

    if (query.status) builder = builder.eq('post_items.status', query.status);
    if (query.platform) builder = builder.eq('post_items.platform', query.platform);
    if (query.date_from) builder = builder.gte('created_at', query.date_from);
    if (query.date_to) builder = builder.lte('created_at', query.date_to);

    const from = (query.page - 1) * query.per_page;
    const { data, count, error } = await builder
      .order('created_at', { ascending: false })
      .range(from, from + query.per_page - 1);

    if (error) {
      console.error('[v1/posts GET] query failed:', error.message);
      return jsonError(500, 'Could not load posts.', 'query_failed');
    }

    return NextResponse.json({
      posts: data ?? [],
      page: query.page,
      per_page: query.per_page,
      total: count ?? 0,
    });
  } catch (error) {
    return handleRouteError('v1/posts GET', error);
  }
}
