import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { seedPostingSchedule } from '@/lib/posts/posting-schedules';

const bodySchema = z.object({
  connection_id: z.string().uuid(),
  frequency: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  timezone: z.string().min(1).max(64),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const input = bodySchema.parse(await req.json());
    return NextResponse.json(await seedPostingSchedule({
      workspaceId,
      connectionId: input.connection_id,
      frequency: input.frequency,
      timezone: input.timezone,
    }));
  } catch (error) {
    return handleRouteError('v1/posting-schedules/seed POST', error);
  }
}
