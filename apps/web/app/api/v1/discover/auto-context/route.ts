import { NextRequest, NextResponse } from 'next/server';
import { autoContextSchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { runAutoContext } from '@/lib/discovery/auto-context';

// POST /api/v1/discover/auto-context — website -> product context
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }

    const input = autoContextSchema.parse({ ...(body as object), workspace_id: workspaceId });

    try {
      const result = await runAutoContext(workspaceId, input.website_url);
      return NextResponse.json(result);
    } catch (extractError) {
      // Extraction failures are user-actionable (JS-only page, unreachable
      // site) — return them as 422 with the reason, not as a 500.
      const message =
        extractError instanceof Error ? extractError.message : 'Context extraction failed';
      console.error('[auto-context] extraction failed:', extractError);
      return jsonError(422, message, 'extraction_failed');
    }
  } catch (error) {
    return handleRouteError('v1/discover/auto-context POST', error);
  }
}
