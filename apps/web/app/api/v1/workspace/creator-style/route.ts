import { NextRequest, NextResponse } from 'next/server';
import { updateCreatorStyleSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const input = updateCreatorStyleSchema.parse(await req.json());
    const db = getServiceDb();
    const { data, error } = await db
      .from('workspace_contexts')
      .upsert(
        { workspace_id: workspaceId, creator_style: input.creator_style },
        { onConflict: 'workspace_id' }
      )
      .select('creator_style')
      .single<{ creator_style: string }>();

    if (error || !data) {
      throw new Error(`[creator-style] update failed: ${error?.message ?? 'no row returned'}`);
    }
    return NextResponse.json(data);
  } catch (error) {
    return handleRouteError('v1/workspace/creator-style PATCH', error);
  }
}
