import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type PostGroupRow, type PostItemRow } from '@/lib/db';
import { getValidToken } from '@/lib/auth/token-manager';
import { createAdapter } from '@/lib/adapters';

type PostGroupWithItems = PostGroupRow & { post_items: PostItemRow[] };

async function loadGroup(
  workspaceId: string,
  postGroupId: string
): Promise<PostGroupWithItems | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('post_groups')
    .select('*, post_items(*)')
    .eq('workspace_id', workspaceId)
    .eq('id', postGroupId)
    .maybeSingle<PostGroupWithItems>();
  if (error) {
    throw new Error(`[v1/posts/:id] lookup failed: ${error.message}`);
  }
  return data;
}

// GET /api/v1/posts/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const group = await loadGroup(workspaceId, id);
    if (!group) {
      return jsonError(404, 'Post not found.', 'not_found');
    }
    return NextResponse.json(group);
  } catch (error) {
    return handleRouteError('v1/posts/:id GET', error);
  }
}

// DELETE /api/v1/posts/:id — cancels pending items; published items are
// deleted on the platform (best effort) and marked 'deleted'.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const group = await loadGroup(workspaceId, id);
    if (!group) {
      return jsonError(404, 'Post not found.', 'not_found');
    }

    const db = getServiceDb();
    const results: Array<{ item_id: string; deleted: boolean; note?: string }> = [];

    for (const item of group.post_items) {
      if (item.status === 'deleted') {
        results.push({ item_id: item.id, deleted: true });
        continue;
      }

      let note: string | undefined;
      if (item.status === 'published' && item.platform_post_id) {
        try {
          const { token, connection } = await getValidToken(item.connection_id);
          const adapter = createAdapter(connection.platform);
          await adapter.deletePost(item.platform_post_id, token);
        } catch (error) {
          note = 'Platform deletion failed — removed from Prolora only';
          console.error(`[v1/posts/:id DELETE] platform delete failed for ${item.id}:`, error);
        }
      }

      const { error } = await db
        .from('post_items')
        .update({ status: 'deleted' })
        .eq('id', item.id);
      if (error) {
        throw new Error(`[v1/posts/:id] delete update failed: ${error.message}`);
      }
      results.push({ item_id: item.id, deleted: true, ...(note ? { note } : {}) });
    }

    // Read-back: every item must now be 'deleted' (Double Assurance).
    const { data: verify, error: verifyError } = await db
      .from('post_items')
      .select('id, status')
      .eq('post_group_id', id)
      .returns<Array<Pick<PostItemRow, 'id' | 'status'>>>();
    if (verifyError || (verify ?? []).some((item) => item.status !== 'deleted')) {
      throw new Error('[v1/posts/:id] delete verification failed');
    }

    return NextResponse.json({ post_group_id: id, items: results });
  } catch (error) {
    return handleRouteError('v1/posts/:id DELETE', error);
  }
}
