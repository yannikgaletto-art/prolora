import { NextRequest, NextResponse } from 'next/server';
import { productProfileUpdateSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getProductProfile, updateProductProfile } from '@/lib/product/profile';

// GET/PATCH /api/v1/product/profile — the workspace's product profile
// (GOAL-RUN9 §6, D1: one workspace = one product).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const profile = await getProductProfile(workspaceId);
    return NextResponse.json(profile);
  } catch (error) {
    return handleRouteError('v1/product/profile GET', error);
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const patch = productProfileUpdateSchema.parse(body);
    await updateProductProfile(workspaceId, patch);
    const profile = await getProductProfile(workspaceId);
    return NextResponse.json(profile);
  } catch (error) {
    return handleRouteError('v1/product/profile PATCH', error);
  }
}
