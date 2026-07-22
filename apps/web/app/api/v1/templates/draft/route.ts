import { NextRequest, NextResponse } from 'next/server';
import { templateDraftSchema, type TemplateDraftResponse } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import { getTemplateById } from '@/lib/templates/catalog';
import { renderScaffold } from '@/lib/templates/scaffold';
import { generateTemplateDraft } from '@/lib/templates/draft-service';

// POST /api/v1/templates/draft — two modes (GOAL-RUN4 T1-5):
// 'scaffold' = deterministic string assembly, 0 credits, no AI path touched;
// 'ai' = LLM draft, 1 credit, quota-gated in the service.
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = templateDraftSchema.parse(body);

    if (input.mode === 'scaffold') {
      const template = getTemplateById(input.template_id);
      if (!template) {
        throw new ApiError(404, `Unknown template: ${input.template_id}`, 'template_not_found');
      }
      const response: TemplateDraftResponse = {
        template_id: template.id,
        draft: {
          content: renderScaffold(template, input.slots),
          manual_steps: template.manual_steps,
          recommended_platforms: template.recommended_platforms,
        },
        credits_used: 0,
      };
      return NextResponse.json(response);
    }

    const result = await generateTemplateDraft(workspaceId, {
      templateId: input.template_id,
      slots: input.slots,
      targetPlatforms: input.target_platforms,
    });

    const response: TemplateDraftResponse = {
      template_id: input.template_id,
      draft: {
        content: result.content,
        first_comment: result.first_comment,
        slides: result.slides,
        manual_steps: result.manual_steps,
        recommended_platforms: result.recommended_platforms,
        truncated: result.truncated,
      },
      credits_used: result.credits_used,
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError('v1/templates/draft POST', error);
  }
}
