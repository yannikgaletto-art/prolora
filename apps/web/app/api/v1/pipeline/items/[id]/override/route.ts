import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { recordGateOverride } from '@/lib/pipeline/state';

// POST /api/v1/pipeline/items/:id/override — der Übersteuern-Knopf (D1).
//
// Übersteuern ist erlaubt, aber NIE stillschweigend: `overriddenBy`,
// Zeitstempel und Grund werden auf der Variante UND im unveränderlichen
// Übergangs-Protokoll festgehalten. Ohne Protokoll wäre das Gate nur eine
// Bitte — deshalb ist `reason` Pflicht, nicht optional.
const bodySchema = z.object({
  variant_id: z.string().uuid(),
  reason: z.string().trim().min(10).max(1000),
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
    const overriddenBy = auth.userId ?? auth.apiKeyId ?? 'unknown';

    const overriddenAt = await recordGateOverride(auth.workspaceId, {
      variantId: input.variant_id,
      contentItemId: id,
      overriddenBy,
      reason: input.reason,
    });

    return NextResponse.json({
      overridden_by: overriddenBy,
      overridden_at: overriddenAt,
      reason: input.reason,
    });
  } catch (error) {
    return handleRouteError('v1/pipeline/items/:id/override POST', error);
  }
}
