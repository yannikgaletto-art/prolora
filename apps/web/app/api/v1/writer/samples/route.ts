import { NextRequest, NextResponse } from 'next/server';
import { platformTypeSchema } from '@prolora/shared';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { createContentSample, listContentSamples } from '@/lib/writer/samples';

const createSampleSchema = z.object({
  kind: z.enum(['golden', 'avoid']),
  origin: z.enum(['pasted', 'published', 'imported']),
  content: z.string().trim().min(40).max(20_000),
  platform: platformTypeSchema.optional(),
  source_post_item_id: z.string().uuid().optional(),
  source_url: z.string().url().optional(),
  label: z.string().trim().max(120).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const samples = await listContentSamples(workspaceId);
    return NextResponse.json({ samples });
  } catch (error) {
    return handleRouteError('v1/writer/samples GET', error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = createSampleSchema.parse(body);
    const sample = await createContentSample(workspaceId, input);
    return NextResponse.json({ sample }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/writer/samples POST', error);
  }
}
