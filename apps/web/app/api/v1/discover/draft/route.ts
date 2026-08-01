import { NextRequest, NextResponse } from 'next/server';
import { draftRequestSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { generateDraft } from '@/lib/discovery/draft-assist';

// POST /api/v1/discover/draft — generate a reply draft for an opportunity.
// The draft is returned as TEXT for the user to copy. Prolora never posts
// it anywhere (Invariante D1).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = draftRequestSchema.parse(body);
    const draft = await generateDraft(workspaceId, input.opportunity_id, input.voice_config, {
      language: input.output_language,
      mentionMode: input.product_mention_mode,
    });

    return NextResponse.json(draft);
  } catch (error) {
    return handleRouteError('v1/discover/draft POST', error);
  }
}
