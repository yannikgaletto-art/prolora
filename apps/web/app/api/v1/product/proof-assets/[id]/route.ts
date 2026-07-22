import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { deleteProofAsset } from '@/lib/product/profile';

const idSchema = z.string().uuid();

// DELETE /api/v1/product/proof-assets/[id] (GOAL-RUN9 §6 T0.2).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) {
      return jsonError(400, 'Invalid proof asset id.', 'invalid_request');
    }
    const deleted = await deleteProofAsset(workspaceId, parsed.data);
    if (!deleted) {
      return jsonError(404, 'Proof asset not found.', 'not_found');
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleRouteError('v1/product/proof-assets DELETE', error);
  }
}
