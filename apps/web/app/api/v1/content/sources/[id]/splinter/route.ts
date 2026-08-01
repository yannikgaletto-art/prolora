import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type ConnectionRow, type ContentSourceRow } from '@/lib/db';
import { splinterPillar } from '@/lib/content/splinter';
import { z } from 'zod';

const generationSchema = z.object({
  output_language: z.enum(['de', 'en']),
  product_mention_mode: z.enum(['adaptive', 'include', 'exclude']),
}).strict();

// POST /api/v1/content/sources/:id/splinter — run the splinter engine on a
// saved pillar and persist the suggestions on the source (GOAL-RUN6 §12).
// Suggestions are proposals only: accepting one goes through the normal
// createPost draft path — nothing here publishes anything.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const generation = generationSchema.parse(await req.json());
    const { id } = await params;
    const db = getServiceDb();

    const { data: source, error } = await db
      .from('content_sources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle<ContentSourceRow>();
    if (error) {
      throw new Error(`[splinter] source lookup failed: ${error.message}`);
    }
    if (!source) {
      return jsonError(404, 'Pillar not found.', 'not_found');
    }

    // Splinters target platforms the workspace can actually publish to.
    const { data: connections, error: connError } = await db
      .from('platform_connections')
      .select('platform, status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .returns<Array<Pick<ConnectionRow, 'platform' | 'status'>>>();
    if (connError) {
      throw new Error(`[splinter] connections lookup failed: ${connError.message}`);
    }
    const activePlatforms = [...new Set((connections ?? []).map((c) => c.platform))];

    const result = await splinterPillar(workspaceId, {
      title: source.title,
      body: source.body_md,
      activePlatforms,
      outputLanguage: generation.output_language,
      productMentionMode: generation.product_mention_mode,
    });

    const { error: updateError } = await db
      .from('content_sources')
      .update({
        splinters: result.suggestions,
        splintered_at: new Date().toISOString(),
        status: 'splintered',
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId);
    if (updateError) {
      // The user still gets the result — persistence failure is logged, not fatal.
      console.error('[splinter] persist failed:', updateError.message);
    }

    return NextResponse.json({
      source_id: id,
      core_ideas: result.core_ideas,
      suggestions: result.suggestions,
      warnings: result.warnings,
      credits_used: result.credits_used,
    });
  } catch (error) {
    return handleRouteError('v1/content/sources/:id/splinter POST', error);
  }
}
