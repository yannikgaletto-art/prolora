import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import { deleteContentSample, updateContentSample } from '@/lib/writer/samples';

const idSchema = z.string().uuid();
const updateSampleSchema = z
  .object({
    active: z.boolean().optional(),
    label: z.string().trim().max(120).nullable().optional(),
  })
  .refine((input) => input.active !== undefined || input.label !== undefined, {
    message: 'at least one field is required',
  });

async function getMutationWorkspaceId(req: NextRequest): Promise<string> {
  const auth = await authenticate(req);
  if (auth.method !== 'session' || auth.workspaceRole !== 'admin') {
    throw new ApiError(
      403,
      'Only workspace owners and admins can manage Content DNA samples.',
      'forbidden'
    );
  }
  return auth.workspaceId;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getMutationWorkspaceId(req);
    const { id } = await params;
    const sampleId = idSchema.parse(id);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = updateSampleSchema.parse(body);
    const sample = await updateContentSample(workspaceId, sampleId, input);
    if (!sample) {
      return jsonError(404, 'Content DNA sample not found.', 'not_found');
    }
    return NextResponse.json({ sample });
  } catch (error) {
    return handleRouteError('v1/writer/samples/:id PATCH', error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getMutationWorkspaceId(req);
    const { id } = await params;
    const sampleId = idSchema.parse(id);
    const deleted = await deleteContentSample(workspaceId, sampleId);
    if (!deleted) {
      return jsonError(404, 'Content DNA sample not found.', 'not_found');
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleRouteError('v1/writer/samples/:id DELETE', error);
  }
}
