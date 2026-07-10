import { getServiceDb, type DiscoveryCommunityRow } from '@/lib/db';

// Server Component read path (F0-4, Pfad A) for the Discover community list —
// mirrors the query in app/api/v1/discover/communities/route.ts GET, but is
// called directly from Server Components instead of over fetch().
export async function getCommunities(workspaceId: string): Promise<DiscoveryCommunityRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('discovery_communities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('relevance_score', { ascending: false })
    .returns<DiscoveryCommunityRow[]>();
  if (error) {
    throw new Error(`[list-communities] query failed: ${error.message}`);
  }
  return data ?? [];
}
