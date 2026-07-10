import { NextRequest, NextResponse } from 'next/server';
import { communityDiscoverySchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { mapCommunities } from '@/lib/discovery/community-mapper';
import { getServiceDb, type DiscoveryCommunityRow } from '@/lib/db';

// POST /api/v1/discover/communities — map ICP -> relevant communities
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    // workspace_id in the schema is legacy — auth wins (Invariante 2).
    const input = communityDiscoverySchema.parse({ ...(body as object), workspace_id: workspaceId });

    const communities = await mapCommunities({
      workspaceId,
      productDescription: input.product_description,
      targetAudience: input.target_audience,
      competitors: input.competitors,
    });

    return NextResponse.json({ communities, total: communities.length });
  } catch (error) {
    return handleRouteError('v1/discover/communities POST', error);
  }
}

// GET /api/v1/discover/communities — list mapped communities
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const db = getServiceDb();
    const { data, error } = await db
      .from('discovery_communities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('relevance_score', { ascending: false })
      .returns<DiscoveryCommunityRow[]>();
    if (error) {
      throw new Error(`[discover/communities] query failed: ${error.message}`);
    }
    return NextResponse.json({ communities: data ?? [] });
  } catch (error) {
    return handleRouteError('v1/discover/communities GET', error);
  }
}
