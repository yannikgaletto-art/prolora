import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { adaptContentForPlatforms } from '@/lib/ai/adapt-content';
import { getPlatformRules } from '@/lib/validation/platform-rules';
import { resolveManualGenerationContexts } from '@/lib/generation/manual';

const adaptRequestSchema = z.object({
  content: z.string().min(1).max(10000),
  platforms: z
    .array(z.enum(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']))
    .min(1)
    .max(5),
  output_language: z.enum(['de', 'en']),
  product_mention_mode: z.enum(['adaptive', 'include', 'exclude']),
});

// POST /api/v1/content/adapt — standalone adaptation (no post created).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const { content, platforms, output_language, product_mention_mode } = adaptRequestSchema.parse(body);
    const contexts = await resolveManualGenerationContexts(
      workspaceId,
      platforms,
      { language: output_language, mentionMode: product_mention_mode },
      { category: 'compose' }
    );
    const results = await adaptContentForPlatforms(
      workspaceId,
      content,
      platforms.map((platform) => ({
        platform,
        characterLimit: getPlatformRules(platform).max_text_length,
      })),
      contexts
    );

    return NextResponse.json({
      adaptations: results.map((r) => ({
        platform: r.platform,
        content: r.content,
        adapted: r.adapted,
        ...(r.warning ? { warning: r.warning } : {}),
      })),
    });
  } catch (error) {
    return handleRouteError('v1/content/adapt POST', error);
  }
}
