import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { inngest } from '@/lib/inngest/client';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';

const runSchema = z
  .object({
    mode: z.enum(['normal', 'shadow']).default('normal'),
    limit: z.literal(1).default(1),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const { userId } = await requireWriterOwnerOrAdmin(auth);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = runSchema.parse(body);
    await inngest.send({
      name: 'writer/run',
      data: {
        workspaceId: auth.workspaceId,
        mode: input.mode,
        requestedBy: userId,
      },
    });
    return NextResponse.json({ queued: true, mode: input.mode }, { status: 202 });
  } catch (error) {
    return handleRouteError('v1/writer/run POST', error);
  }
}
