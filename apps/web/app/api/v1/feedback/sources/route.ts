import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type FeedbackSourceRow } from '@/lib/db';

// Config values that must never leave the backend. 'key' only matches as a
// standalone segment (api_key, apiKey) so brand_keywords stays visible.
const SECRET_KEY_PATTERN = /token|secret|password|(^|[_\-.])api[_\-.]?key|(^|[_\-.])keys?($|[_\-.])/i;

function sanitizeSourceConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

function serializeSource(source: FeedbackSourceRow): Record<string, unknown> {
  return {
    id: source.id,
    source_type: source.source_type,
    config: sanitizeSourceConfig(source.config),
    status: source.status,
    last_polled_at: source.last_polled_at,
    created_at: source.created_at,
  };
}

// GET /api/v1/feedback/sources — list this workspace's sources (secrets stripped).
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);

    const db = getServiceDb();
    const { data, error } = await db
      .from('feedback_sources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .returns<FeedbackSourceRow[]>();
    if (error) {
      console.error('[v1/feedback/sources GET] query failed:', error.message);
      return jsonError(500, 'Could not load feedback sources.', 'query_failed');
    }

    return NextResponse.json({ sources: (data ?? []).map(serializeSource) });
  } catch (error) {
    return handleRouteError('v1/feedback/sources GET', error);
  }
}

const createSourceSchema = z.object({
  source_type: z.enum(['reddit', 'widget']),
  config: z.record(z.unknown()),
});

// POST /api/v1/feedback/sources — register a new source (active immediately).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = createSourceSchema.parse(body);

    const db = getServiceDb();
    const { data: inserted, error } = await db
      .from('feedback_sources')
      .insert({
        workspace_id: workspaceId,
        source_type: input.source_type,
        config: input.config,
        status: 'active',
      })
      .select('id')
      .single<{ id: string }>();
    if (error || !inserted) {
      throw new Error(
        `[v1/feedback/sources POST] insert failed: ${error?.message ?? 'no row returned'}`
      );
    }

    // Read-back verify (Double Assurance) — scoped to the workspace.
    const { data: verified, error: verifyError } = await db
      .from('feedback_sources')
      .select('*')
      .eq('id', inserted.id)
      .eq('workspace_id', workspaceId)
      .single<FeedbackSourceRow>();
    if (verifyError || !verified) {
      throw new Error('[v1/feedback/sources POST] write verification failed');
    }

    return NextResponse.json(serializeSource(verified), { status: 201 });
  } catch (error) {
    return handleRouteError('v1/feedback/sources POST', error);
  }
}
