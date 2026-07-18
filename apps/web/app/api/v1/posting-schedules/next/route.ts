import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { nextFreePostingSlot } from '@/lib/posts/posting-schedules';

const bodySchema = z.object({
  connection_ids: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const input = bodySchema.parse(await req.json());
    const slot = await nextFreePostingSlot({ workspaceId, connectionIds: input.connection_ids });
    return NextResponse.json({ slot });
  } catch (error) {
    return handleRouteError('v1/posting-schedules/next POST', error);
  }
}
