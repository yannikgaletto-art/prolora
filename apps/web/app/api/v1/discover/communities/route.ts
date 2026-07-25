import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { communityDiscoverySchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { mapCommunities } from '@/lib/discovery/community-mapper';
import { INTEGRATION_PROVIDERS, isIntegrationProvider } from '@/lib/integrations/types';
import { getServiceDb, type DiscoveryCommunityRow } from '@/lib/db';

// `platforms` is validated here rather than in @prolora/shared: the shared enum
// still lists the pre-multi-provider set, and widening a published contract is
// a separate decision from making Discover multi-platform. The shared schema
// never sees the field.
const platformsSchema = z
  .array(z.string().refine(isIntegrationProvider, { message: 'unknown platform' }))
  .max(INTEGRATION_PROVIDERS.length)
  .optional();

// POST /api/v1/discover/communities — map ICP -> relevant communities
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const { platforms: rawPlatforms, ...rest } = (body ?? {}) as Record<string, unknown>;
    const platforms = platformsSchema.parse(rawPlatforms);

    // workspace_id in the schema is legacy — auth wins (Invariante 2).
    const input = communityDiscoverySchema.parse({ ...rest, workspace_id: workspaceId });

    const communities = await mapCommunities({
      workspaceId,
      productDescription: input.product_description,
      targetAudience: input.target_audience,
      competitors: input.competitors,
      platforms,
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
