import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { platformTypeSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { createPost } from '@/lib/posts/create-post';
import { nextFreePostingSlot } from '@/lib/posts/posting-schedules';
import { runDeterministicChecks } from '@/lib/scoring/deterministic';

const bodySchema = z.object({
  connection_id: z.string().uuid(),
  platform: platformTypeSchema,
  content: z.string().min(1).max(30_000),
  first_comment: z.string().max(2_000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const input = bodySchema.parse(await req.json());
    const db = getServiceDb();
    const { data: connection, error: connectionError } = await db
      .from('platform_connections')
      .select('platform')
      .eq('workspace_id', workspaceId)
      .eq('id', input.connection_id)
      .maybeSingle<{ platform: string }>();
    if (connectionError) throw new Error(`[splinter-accept] connection lookup failed: ${connectionError.message}`);
    if (!connection) throw new ApiError(404, 'Connection not found.', 'connection_not_found');
    if (connection.platform !== input.platform) {
      throw new ApiError(400, 'Platform does not match the selected connection.', 'platform_mismatch');
    }
    const checks = runDeterministicChecks(input.content, input.platform, {
      firstComment: input.first_comment,
    });
    const slot = await nextFreePostingSlot({
      workspaceId,
      connectionIds: [input.connection_id],
    });
    if (!slot) {
      throw new ApiError(409, 'No active queue slot. Build a posting plan first.', 'no_queue_slot');
    }
    const { response, warnings } = await createPost(workspaceId, {
      content: input.content,
      platforms: [input.connection_id],
      draft: true,
      scheduled_at: slot.instant,
      scheduled_tz: slot.timezone,
      first_comment: input.first_comment,
    }, 'dashboard');

    const { error: logError } = await db.from('usage_logs').insert({
      workspace_id: workspaceId,
      action: 'splinter_accept_checks',
      credits_used: 0,
      metadata: { post_group_id: response.post_group_id, checks },
    });
    if (logError) console.error('[splinter-accept] checks log failed:', logError.message);

    return NextResponse.json({ ...response, slot, checks, warnings }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/content/splinters/accept POST', error);
  }
}
