import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type ConnectionRow, type PostItemRow } from '@/lib/db';

const MIN_PUBLISHED_POSTS = 30;
const MAX_ANALYZED_POSTS = 500;

const paramsSchema = z.object({ id: z.string().uuid() });

interface TimeWindow {
  day_of_week: number;
  hour_utc: number;
  avg_engagement: number;
  samples: number;
}

// Engagement per (UTC weekday, UTC hour) bucket — mirrors the optimal-timing
// Inngest function in lib/inngest/functions/discovery.ts, scoped to one connection.
function computeTimeWindows(
  items: Array<Pick<PostItemRow, 'published_at' | 'metrics'>>
): TimeWindow[] {
  const buckets = new Map<string, { total: number; count: number }>();
  for (const item of items) {
    if (!item.published_at) continue;
    const date = new Date(item.published_at);
    const key = `${date.getUTCDay()}:${date.getUTCHours()}`;
    const metrics = item.metrics ?? {};
    const engagement =
      (typeof metrics.likes === 'number' ? metrics.likes : 0) +
      (typeof metrics.shares === 'number' ? metrics.shares : 0) * 2 +
      (typeof metrics.comments === 'number' ? metrics.comments : 0) * 3;
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    bucket.total += engagement;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const [day, hour] = key.split(':').map(Number);
      return {
        day_of_week: day,
        hour_utc: hour,
        avg_engagement: bucket.total / bucket.count,
        samples: bucket.count,
      };
    })
    .filter((w) => w.samples >= 2)
    .sort((a, b) => b.avg_engagement - a.avg_engagement)
    .slice(0, 3);
}

// GET /api/v1/connections/:id/optimal-times — best posting windows for one connection
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id: connectionId } = paramsSchema.parse(await params);

    const db = getServiceDb();

    // Invariante 2: verify the connection belongs to this workspace before
    // touching post_items (which carry no workspace_id of their own).
    const { data: connection, error: connectionError } = await db
      .from('platform_connections')
      .select('id, workspace_id, platform')
      .eq('id', connectionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle<Pick<ConnectionRow, 'id' | 'workspace_id' | 'platform'>>();

    if (connectionError) {
      console.error('[optimal-times] connection lookup failed:', connectionError.message);
      return jsonError(500, 'Could not load connection.', 'query_failed');
    }
    if (!connection) {
      throw new ApiError(404, 'Connection not found.', 'not_found');
    }

    const { data: items, count, error: itemsError } = await db
      .from('post_items')
      .select('published_at, metrics', { count: 'exact' })
      .eq('connection_id', connectionId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(MAX_ANALYZED_POSTS)
      .returns<Array<Pick<PostItemRow, 'published_at' | 'metrics'>>>();

    if (itemsError) {
      console.error('[optimal-times] post_items query failed:', itemsError.message);
      return jsonError(500, 'Could not load published posts.', 'query_failed');
    }

    const publishedCount = count ?? (items ?? []).length;
    if (publishedCount < MIN_PUBLISHED_POSTS) {
      throw new ApiError(
        404,
        `not enough published posts; need ${MIN_PUBLISHED_POSTS}, have ${publishedCount}`,
        'insufficient_data'
      );
    }

    const windows = computeTimeWindows(items ?? []);
    console.log(
      `[optimal-times] computed ${windows.length} windows for connection ${connectionId} (${publishedCount} published posts)`
    );

    return NextResponse.json({
      connection_id: connection.id,
      platform: connection.platform,
      published_posts: publishedCount,
      windows,
    });
  } catch (error) {
    return handleRouteError('v1/connections/optimal-times GET', error);
  }
}
