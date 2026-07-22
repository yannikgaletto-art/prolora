import { NextRequest, NextResponse } from 'next/server';
import { contentGoalSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { listProofAssets, normalizeProfileFields } from '@/lib/product/profile';
import { listContentReferences, isVerifiedEngagement } from '@/lib/content/references';
import { suggestAngles } from '@/lib/content/angle-service';

// GET /api/v1/concepts/angles?goal=… — "Prolora empfiehlt heute".
// Deterministic, 0 credits (D7): patterns + proof assets, no LLM.
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const parsed = contentGoalSchema.safeParse(req.nextUrl.searchParams.get('goal'));
    if (!parsed.success) {
      return jsonError(400, 'Query parameter "goal" must be a valid content goal.', 'invalid_request');
    }

    const [context, proofAssets, references] = await Promise.all([
      getWorkspaceContext(workspaceId),
      listProofAssets(workspaceId),
      listContentReferences(workspaceId),
    ]);
    const profile = normalizeProfileFields(context);

    const angles = suggestAngles({
      goal: parsed.data,
      productDescription: context?.product_description ?? null,
      coreValue: profile.core_value,
      proofAssets,
      references,
    });

    // Honesty invariant (T1.2): engagement leaves the API only when verified.
    const referenceMeta = new Map(
      references.map((reference) => [
        reference.id,
        {
          id: reference.id,
          hook: reference.hook,
          reusable_pattern: reference.reusable_pattern,
          verified: isVerifiedEngagement(reference),
          engagement: isVerifiedEngagement(reference) ? reference.engagement : null,
        },
      ])
    );

    return NextResponse.json({
      has_profile: Boolean(context?.product_description),
      angles: angles.map((angle) => ({
        ...angle,
        reference: angle.reference_id ? (referenceMeta.get(angle.reference_id) ?? null) : null,
      })),
    });
  } catch (error) {
    return handleRouteError('v1/concepts/angles GET', error);
  }
}
