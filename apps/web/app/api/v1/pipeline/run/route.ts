import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { estimatePipelineRun, runPipeline } from '@/lib/pipeline/orchestrator';

// POST /api/v1/pipeline/run — die Fabrik einen Schritt weiterfahren.
//
// `estimate_only: true` liefert die Credit-Schätzung VOR dem Lauf (§8:
// "Kanal-native Erzeugung — N Kanäle = N LLM-Aufrufe, Credits brennen").
// Die UI ruft erst die Schätzung, dann den Lauf.
const bodySchema = z
  .object({
    limit: z.number().int().min(1).max(25).optional(),
    min_strength: z.number().min(0).max(1).optional(),
    locale: z.enum(['de', 'en', 'es']).optional(),
    estimate_only: z.boolean().optional(),
  })
  .default({});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => ({}));
    const input = bodySchema.parse(body ?? {});

    const estimate = await estimatePipelineRun(workspaceId, { limit: input.limit });
    if (input.estimate_only) {
      return NextResponse.json({ estimate });
    }

    const result = await runPipeline(workspaceId, {
      limit: input.limit,
      minStrength: input.min_strength,
      locale: input.locale,
    });
    return NextResponse.json({ estimate, result });
  } catch (error) {
    return handleRouteError('v1/pipeline/run POST', error);
  }
}
