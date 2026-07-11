import { NextRequest, NextResponse } from 'next/server';
import { templatePrefillSchema, type TemplatePrefillResponse } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { generateSlotSuggestions } from '@/lib/templates/prefill-service';

// POST /api/v1/templates/prefill — AI slot suggestions (GOAL-RUN5 G1, 1 credit).
// The wizard fires this once per template after the user's informed click on
// the step-3 CTA (V2) and caches the result in localStorage (T3).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = templatePrefillSchema.parse(body);

    const result = await generateSlotSuggestions(workspaceId, input.template_id);
    const response: TemplatePrefillResponse = {
      template_id: input.template_id,
      suggestions: result.suggestions,
      credits_used: result.credits_used,
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError('v1/templates/prefill POST', error);
  }
}
