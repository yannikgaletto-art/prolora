import { NextRequest, NextResponse } from 'next/server';
import { proofAssetCreateSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { createProofAsset, listProofAssets } from '@/lib/product/profile';

// GET/POST /api/v1/product/proof-assets (GOAL-RUN9 §6 T0.2).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const assets = await listProofAssets(workspaceId);
    return NextResponse.json({ proof_assets: assets });
  } catch (error) {
    return handleRouteError('v1/product/proof-assets GET', error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = proofAssetCreateSchema.parse(body);
    const asset = await createProofAsset(workspaceId, input);
    return NextResponse.json({ proof_asset: asset }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/product/proof-assets POST', error);
  }
}
