import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getServiceDb, type ConnectionRow } from '@/lib/db';
import { toConnectionDto } from '@/lib/auth/connections';

// GET /api/v1/connections — all connections for the workspace.
// Encrypted credential fields NEVER leave the server (DTO only).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const db = getServiceDb();

    const { data, error } = await db
      .from('platform_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .returns<ConnectionRow[]>();

    if (error) {
      throw new Error(`[v1/connections] query failed: ${error.message}`);
    }

    return NextResponse.json({
      connections: (data ?? []).map(toConnectionDto),
    });
  } catch (error) {
    return handleRouteError('v1/connections GET', error);
  }
}
