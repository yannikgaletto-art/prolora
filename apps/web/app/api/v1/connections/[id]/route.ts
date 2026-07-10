import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type ConnectionRow } from '@/lib/db';
import { toConnectionDto } from '@/lib/auth/connections';

// DELETE /api/v1/connections/[id] — disconnect. Soft-deactivate only: sets
// status='revoked' rather than deleting the row, so publish history and
// audit trails that reference this connection stay intact. Scoped to the
// caller's workspace_id so one workspace can never revoke another's
// connection by guessing an id.
//
// New route file added for F4 (Oracle 2 requires a working disconnect flow
// and no GET/POST/DELETE route existed for this table before this file).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) {
      return jsonError(400, 'Invalid connection id.', 'invalid_id');
    }

    const db = getServiceDb();
    const { data, error } = await db
      .from('platform_connections')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select('*')
      .maybeSingle<ConnectionRow>();

    if (error) {
      throw new Error(`[v1/connections/[id]] update failed: ${error.message}`);
    }
    if (!data) {
      return jsonError(404, 'Connection not found.', 'not_found');
    }

    return NextResponse.json({ connection: toConnectionDto(data) });
  } catch (error) {
    return handleRouteError('v1/connections/[id] DELETE', error);
  }
}
