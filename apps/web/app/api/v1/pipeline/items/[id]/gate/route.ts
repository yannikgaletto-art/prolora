import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { runGateForItem } from '@/lib/pipeline/orchestrator';

// POST /api/v1/pipeline/items/:id/gate — das blockierende Qualitäts-Gate
// (Plan 2 / 2B.2, Entscheidung D1). Schwellen sind pro Aufruf übersteuerbar,
// damit ein zu enges Gate nicht als Codeänderung gelöst werden muss (§8).
const bodySchema = z
  .object({
    locale: z.enum(['de', 'en', 'es']).optional(),
    thresholds: z
      .object({
        deterministic: z
          .object({
            minTotalScore: z.number().min(0).max(40).optional(),
            hardFailOnCharacterLimit: z.boolean().optional(),
          })
          .optional(),
        selfSimilarity: z
          .object({
            minHistory: z.number().int().min(0).max(1000).optional(),
            maxSimilarity: z.number().min(0).max(1).optional(),
            windowDays: z.number().int().min(1).max(365).optional(),
          })
          .optional(),
        structure: z
          .object({ requiredFields: z.array(z.string().min(1)).max(6).optional() })
          .optional(),
        proofBinding: z
          .object({
            ignoreStructuralCounts: z.boolean().optional(),
            ignoreYears: z.boolean().optional(),
            requireProofForComparatives: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .default({});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const { id } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const input = bodySchema.parse(body ?? {});
    const result = await runGateForItem(workspaceId, id, {
      locale: input.locale,
      thresholds: input.thresholds,
    });
    return NextResponse.json({
      item: result.item,
      results: result.results,
      stats: result.stats,
    });
  } catch (error) {
    return handleRouteError('v1/pipeline/items/:id/gate POST', error);
  }
}
