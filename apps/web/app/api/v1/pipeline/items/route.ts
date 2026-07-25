import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { CONTENT_ITEM_STATES, listContentItems, type ContentItemState } from '@/lib/pipeline/state';
import { ingestSignals } from '@/lib/pipeline/orchestrator';

// GET  /api/v1/pipeline/items — Werkstücke der Content-Fabrik (Plan 2 / 2B.1).
// POST /api/v1/pipeline/items — Signale aus dem Inventar zu Werkstücken machen.
//
// Beide Pfade sind workspace-gescoped (Invariante 2) und degradieren vor
// Migration 017 zu einer leeren Liste statt zu einem 500er.

const querySchema = z.object({
  state: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((part) => part.trim()) : undefined))
    .refine(
      (states) =>
        states === undefined ||
        states.every((state) => (CONTENT_ITEM_STATES as readonly string[]).includes(state)),
      { message: `state must be one of: ${CONTENT_ITEM_STATES.join(', ')}` }
    ),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const ingestSchema = z.object({
  min_strength: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = querySchema.parse({
      state: req.nextUrl.searchParams.get('state') ?? undefined,
      limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    });
    const items = await listContentItems(workspaceId, {
      states: query.state as ContentItemState[] | undefined,
      limit: query.limit,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleRouteError('v1/pipeline/items GET', error);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = ingestSchema.parse(body);
    const result = await ingestSignals(workspaceId, {
      minStrength: input.min_strength,
      limit: input.limit,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/pipeline/items POST', error);
  }
}
