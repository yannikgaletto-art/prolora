import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { scheduleGatedItems } from '@/lib/pipeline/orchestrator';

// POST /api/v1/pipeline/schedule — Frequenz-Motor (2B.4).
//
// Wählt aus dem Bestand NACH MIX, nicht nach Reihenfolge, und legt die Slots
// über den vorhandenen DST-sicheren slot-allocator. Der Mix ist pro Aufruf
// übersteuerbar, weil "40/30/20/10" eine Vorgabe ist, keine Naturkonstante.
const bodySchema = z
  .object({
    take: z.number().int().min(1).max(20).optional(),
    mix: z
      .object({
        insight: z.number().min(0).max(1).optional(),
        proof: z.number().min(0).max(1).optional(),
        story: z.number().min(0).max(1).optional(),
        question: z.number().min(0).max(1).optional(),
      })
      .optional(),
  })
  .default({});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => ({}));
    const input = bodySchema.parse(body ?? {});
    const result = await scheduleGatedItems(workspaceId, {
      take: input.take,
      mix: input.mix,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError('v1/pipeline/schedule POST', error);
  }
}
