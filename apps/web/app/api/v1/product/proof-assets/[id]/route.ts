import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { deleteProofAsset } from '@/lib/product/profile';
import { revokeFact } from '@/lib/product/facts';
import { requireWriterOwnerOrAdmin } from '@/lib/writer/policy';

const idSchema = z.string().uuid();
const patchSchema = z.object({ action: z.literal('revoke'), effective_to: z.string().datetime().optional() }).strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    await requireWriterOwnerOrAdmin(auth);
    const id = idSchema.parse((await params).id);
    const body = patchSchema.parse(await req.json());
    const revoked = await revokeFact(auth.workspaceId, id, body.effective_to);
    if (!revoked) return jsonError(404, 'Confirmed fact not found.', 'not_found');
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return handleRouteError('v1/product/proof-assets PATCH', error);
  }
}

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
