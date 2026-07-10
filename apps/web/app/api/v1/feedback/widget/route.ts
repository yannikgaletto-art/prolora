import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, handleRouteError, jsonError } from '@/lib/api/http';
import {
  WIDGET_RETRY_AFTER_SECONDS,
  allowedOriginsFromSource,
  findWidgetSource,
  ingestWidgetFeedback,
  resolveWorkspaceBySlug,
} from '@/lib/listeners/widget-listener';

// PUBLIC endpoint — the embeddable feedback widget posts here without auth.
// Tenant resolution happens via the workspace slug in the body.

const widgetSubmissionSchema = z.object({
  workspace: z.string().min(1).max(100),
  content: z.string().min(10, 'content must be at least 10 characters').max(10000),
  email: z.string().email().max(320).optional(),
  // Accepted for forward compatibility but dropped: raw_feedback has no
  // category column and the analyze pipeline classifies feedback itself.
  category: z.string().max(100).optional(),
  rating: z.number().min(1).max(5).optional(),
});

const CORS_BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function corsHeaders(requestOrigin: string | null, allowedOrigins: string[] | null): Headers {
  const headers = new Headers(CORS_BASE_HEADERS);
  if (!allowedOrigins) {
    headers.set('Access-Control-Allow-Origin', '*');
    return headers;
  }
  headers.set('Vary', 'Origin');
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
  } else {
    // Origin not allowlisted: expose the first configured origin so the
    // browser blocks the response for everyone else.
    headers.set('Access-Control-Allow-Origin', allowedOrigins[0]);
  }
  return headers;
}

function withCors(response: NextResponse, headers: Headers): NextResponse {
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

// Preflight. The browser sends no body, so the workspace can only come from
// a ?workspace= query param; without it we answer permissively — the POST
// itself re-checks against the workspace's configured allowed_origins.
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin');
  let allowedOrigins: string[] | null = null;

  const slug = req.nextUrl.searchParams.get('workspace');
  if (slug) {
    try {
      const workspace = await resolveWorkspaceBySlug(slug);
      if (workspace) {
        allowedOrigins = allowedOriginsFromSource(await findWidgetSource(workspace.id));
      }
    } catch (error) {
      // Preflight must never fail hard — fall back to permissive headers.
      console.error(
        `[listener:widget] preflight lookup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin, allowedOrigins),
  });
}

// POST /api/v1/feedback/widget — public feedback intake.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get('origin');
  let cors = corsHeaders(origin, null);

  try {
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return withCors(jsonError(400, 'Request body must be valid JSON.', 'invalid_request'), cors);
    }
    const submission = widgetSubmissionSchema.parse(body);

    const workspace = await resolveWorkspaceBySlug(submission.workspace);
    if (!workspace) {
      return withCors(jsonError(404, 'Unknown workspace.', 'workspace_not_found'), cors);
    }

    const widgetSource = await findWidgetSource(workspace.id);
    cors = corsHeaders(origin, allowedOriginsFromSource(widgetSource));

    const result = await ingestWidgetFeedback(workspace.id, widgetSource, {
      content: submission.content,
      email: submission.email,
      category: submission.category,
      rating: submission.rating,
    });

    return withCors(
      NextResponse.json(
        { raw_feedback_id: result.rawFeedbackId, status: 'queued_for_analysis' },
        { status: 201 }
      ),
      cors
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) {
      const response = NextResponse.json(
        { error: error.message, code: error.code, retry_after: WIDGET_RETRY_AFTER_SECONDS },
        { status: 429, headers: { 'Retry-After': String(WIDGET_RETRY_AFTER_SECONDS) } }
      );
      return withCors(response, cors);
    }
    return withCors(handleRouteError('v1/feedback/widget POST', error), cors);
  }
}
