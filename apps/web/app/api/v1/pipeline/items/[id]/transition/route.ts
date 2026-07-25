import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { CONTENT_ITEM_STATES } from '@/lib/pipeline/state';
import { applyManualTransition } from '@/lib/pipeline/orchestrator';

// POST /api/v1/pipeline/items/:id/transition — manueller Zustandswechsel.
//
// `reason` ist Pflicht und hat min(1) — nicht aus Formalismus: ein `rejected`
// ohne Grund ist ein Bug, kein Zustand (Plan 2 §2). Zod, Anwendungscode und
// CHECK-Constraint sagen hier dasselbe.
const bodySchema = z.object({
  to: z.enum(CONTENT_ITEM_STATES),
  reason: z.string().trim().min(1).max(1000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const auth = await authenticate(req);
    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = bodySchema.parse(body);
    const item = await applyManualTransition(auth.workspaceId, id, {
      to: input.to,
      reason: input.reason,
      actor: 'user',
      actorId: auth.userId ?? auth.apiKeyId ?? null,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return handleRouteError('v1/pipeline/items/:id/transition POST', error);
  }
}
