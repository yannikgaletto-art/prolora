import { CONNECTION_ROW_COLUMNS, getServiceDb, type ConnectionRow } from '@/lib/db';
import { toConnectionDto } from '@/lib/auth/connections';
import { characterLimitFor } from '@/lib/posts/create-post';
import type { Connection } from '@prolora/shared';

// The shared `Connection` DTO (packages/shared/types.ts, read-only) does not
// carry `last_used_at` — it is a display-only field the /connections page
// needs (Oracle 2), so this list-read extends the DTO by one field rather
// than widening the shared contract. `toConnectionDto` is still reused
// as-is for every secret-stripping decision.
export interface ConnectionListItem extends Connection {
  last_used_at: string | null;
}

// Server Component read path for /connections — mirrors the filter/order
// logic of GET /api/v1/connections (workspace-scoped, created_at asc)
// without importing the route handler.
export async function getConnections(workspaceId: string): Promise<ConnectionListItem[]> {
  const db = getServiceDb();

  const { data, error } = await db
    .from('platform_connections')
    .select(CONNECTION_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .returns<ConnectionRow[]>();

  if (error) {
    throw new Error(`[list-connections] query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    ...toConnectionDto(row),
    last_used_at: row.last_used_at,
  }));
}

// --- Appended for F1 Publish ---
// getConnections() above already covers "list connections for a workspace",
// but the Publish composer additionally needs a per-connection character
// limit (Mastodon's is instance-specific) to power the live counter warning.
// New export, does not touch the function above.
export interface ConnectionWithLimit extends Connection {
  character_limit: number;
}

export async function getConnectionsWithCharacterLimits(
  workspaceId: string
): Promise<ConnectionWithLimit[]> {
  const db = getServiceDb();

  const { data, error } = await db
    .from('platform_connections')
    .select(CONNECTION_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .returns<ConnectionRow[]>();

  if (error) {
    throw new Error(`[list-connections] query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    ...toConnectionDto(row),
    character_limit: characterLimitFor(row),
  }));
}
