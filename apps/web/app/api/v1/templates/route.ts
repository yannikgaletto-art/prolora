import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PLAN_LIMITS, type PlanType, type TemplateListResponse } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { filterTemplates } from '@/lib/templates/filter';

const listQuerySchema = z.object({
  intent: z.enum(['value', 'product', 'community', 'social_proof', 'personal_brand']).optional(),
  post_type: z
    .enum([
      'value_edu',
      'product_demo',
      'review',
      'unboxing',
      'tutorial',
      'transformation',
      'build_in_public',
      'lifestyle',
      'community_fomo',
      'crowdsourcing',
    ])
    .optional(),
  platform: z.enum(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']).optional(),
  format: z.enum(['text', 'thread', 'carousel_pdf', 'image_text', 'poll']).optional(),
});

// GET /api/v1/templates — static catalog with filters (GOAL-RUN4 T1-5).
// The catalog itself never touches the DB (Oracle 1); the two workspace
// lookups only power UI hints (prefill + AI-button gating).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const params = req.nextUrl.searchParams;
    const filter = listQuerySchema.parse({
      intent: params.get('intent') ?? undefined,
      post_type: params.get('post_type') ?? undefined,
      platform: params.get('platform') ?? undefined,
      format: params.get('format') ?? undefined,
    });

    const templates = filterTemplates(filter).map((template) => {
      const { prompt_hints: _promptHints, ...summary } = template;
      return summary;
    });

    const context = await getWorkspaceContext(workspaceId);

    const db = getServiceDb();
    const { data: workspace, error } = await db
      .from('workspaces')
      .select('plan')
      .eq('id', workspaceId)
      .single<{ plan: PlanType }>();
    if (error || !workspace) {
      throw new Error(`[templates] workspace lookup failed: ${error?.message ?? 'not found'}`);
    }
    const aiEnabled = (PLAN_LIMITS[workspace.plan]?.ai_credits ?? 0) > 0;

    const response: TemplateListResponse = {
      templates,
      context_available: context !== null,
      ai_enabled: aiEnabled,
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError('v1/templates GET', error);
  }
}
