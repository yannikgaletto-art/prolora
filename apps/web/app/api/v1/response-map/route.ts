import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type ResponseMapRow } from '@/lib/db';

// GET /api/v1/response-map — proven answers, best engagement first
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const db = getServiceDb();
    const { data, error } = await db
      .from('response_map')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('avg_engagement', { ascending: false })
      .returns<ResponseMapRow[]>();
    if (error) {
      throw new Error(`[response-map] query failed: ${error.message}`);
    }
    return NextResponse.json({ entries: data ?? [] });
  } catch (error) {
    return handleRouteError('v1/response-map GET', error);
  }
}

const createEntrySchema = z.object({
  question_pattern: z.string().min(3).max(500),
  intent_type: z.enum(['question', 'comparison', 'recommendation', 'complaint', 'discussion']).optional(),
  best_answer: z.string().min(10).max(10000),
  proof_asset_url: z.string().url().optional(),
  link_policy: z.enum(['never', 'if_asked', 'in_followup']).default('if_asked'),
  avg_engagement: z.number().min(0).optional(),
});

// POST /api/v1/response-map — add a proven answer
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = createEntrySchema.parse(body);

    const db = getServiceDb();
    const { data: created, error } = await db
      .from('response_map')
      .insert({
        workspace_id: workspaceId,
        question_pattern: input.question_pattern,
        intent_type: input.intent_type ?? null,
        best_answer: input.best_answer,
        proof_asset_url: input.proof_asset_url ?? null,
        link_policy: input.link_policy,
        avg_engagement: input.avg_engagement ?? 0,
      })
      .select('*')
      .single<ResponseMapRow>();
    if (error || !created) {
      throw new Error(`[response-map] insert failed: ${error?.message ?? 'no row'}`);
    }

    return NextResponse.json({ entry: created }, { status: 201 });
  } catch (error) {
    return handleRouteError('v1/response-map POST', error);
  }
}
