import { getServiceDb, type ResponseMapRow } from '@/lib/db';

// Server Component read path (F0-4, Pfad A) for the Response Map list —
// mirrors the query in app/api/v1/response-map/route.ts GET exactly
// (avg_engagement desc), but is called directly from Server Components
// instead of over fetch().
export async function getResponseMapEntries(workspaceId: string): Promise<ResponseMapRow[]> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('response_map')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('avg_engagement', { ascending: false })
    .returns<ResponseMapRow[]>();
  if (error) {
    throw new Error(`[list-response-map] query failed: ${error.message}`);
  }
  return data ?? [];
}
