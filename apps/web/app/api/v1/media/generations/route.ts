import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { createGeneration, estimateEur, getBudgetStatus } from '@/lib/media/generation';

// POST /api/v1/media/generations — validate, reserve budget atomically, create
// the generation record, emit the worker event (spec "API Boundary"). The
// workspace always comes from the authenticated session, never the client.
const bodySchema = z.object({
  kind: z.enum(['image', 'video']),
  prompt: z.string().min(3).max(4000),
  format: z.enum(['square', 'portrait', 'landscape']),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body = bodySchema.parse(await req.json());

    const { generation, estimated_eur } = await createGeneration(workspaceId, body);
    const budget = await getBudgetStatus(workspaceId);

    return NextResponse.json(
      {
        generation: {
          id: generation.id,
          kind: generation.kind,
          format: generation.format,
          status: generation.status,
          model: generation.model,
          created_at: generation.created_at,
        },
        estimated_eur,
        budget,
      },
      { status: 202 }
    );
  } catch (error) {
    return handleRouteError('v1/media/generations POST', error);
  }
}

// GET /api/v1/media/generations?kind=image — recent generations + the current
// budget, for the durable-progress UI.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const budget = await getBudgetStatus(workspaceId);
    return NextResponse.json({
      budget,
      estimates: { image_eur: estimateEur('image'), video_eur: estimateEur('video') },
    });
  } catch (error) {
    return handleRouteError('v1/media/generations GET', error);
  }
}
