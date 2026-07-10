import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { feedbackQuerySchema } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type FeedbackItemRow } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';

// workspace_id comes from auth, never from the query (Invariante 2).
const listQuerySchema = feedbackQuerySchema.omit({ workspace_id: true }).extend({
  is_duplicate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// GET /api/v1/feedback — paginated list with filters
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = listQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const db = getServiceDb();
    let builder = db
      .from('feedback_items')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId);

    if (query.platform) builder = builder.eq('source_platform', query.platform);
    if (query.sentiment) builder = builder.eq('sentiment', query.sentiment);
    if (query.category) builder = builder.eq('category', query.category);
    if (query.urgency) builder = builder.eq('urgency', query.urgency);
    if (query.is_duplicate !== undefined) builder = builder.eq('is_duplicate', query.is_duplicate);
    if (query.date_from) builder = builder.gte('created_at', query.date_from);
    if (query.date_to) builder = builder.lte('created_at', query.date_to);
    if (query.search) {
      const term = query.search.replace(/[%_,()]/g, ' ').trim();
      if (term) {
        builder = builder.or(
          `original_content.ilike.%${term}%,summary_en.ilike.%${term}%,summary_de.ilike.%${term}%`
        );
      }
    }

    const from = (query.page - 1) * query.per_page;
    const { data, count, error } = await builder
      .order('created_at', { ascending: false })
      .range(from, from + query.per_page - 1)
      .returns<FeedbackItemRow[]>();

    if (error) {
      console.error('[v1/feedback GET] query failed:', error.message);
      return jsonError(500, 'Could not load feedback.', 'query_failed');
    }

    // embedding is an internal vector — strip it from responses.
    const items = (data ?? []).map(({ embedding: _embedding, ...rest }) => rest);

    return NextResponse.json({
      feedback: items,
      page: query.page,
      per_page: query.per_page,
      total: count ?? 0,
    });
  } catch (error) {
    return handleRouteError('v1/feedback GET', error);
  }
}

const manualFeedbackSchema = z.object({
  content: z.string().min(1).max(10000),
  source_platform: z.string().max(50).default('manual'),
  source_url: z.string().url().optional(),
  author_name: z.string().max(200).optional(),
  rating: z.number().min(0).max(5).optional(),
  source_date: z.string().datetime().optional(),
});

// POST /api/v1/feedback — manual import (e.g. widget/dashboard).
// Raw feedback is stored FIRST (durable), analysis runs async (Invariante 4).
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const body: unknown = await req.json().catch(() => null);
    if (body === null) {
      return jsonError(400, 'Request body must be valid JSON.', 'invalid_request');
    }
    const input = manualFeedbackSchema.parse(body);

    const db = getServiceDb();
    const { data: inserted, error } = await db
      .from('raw_feedback')
      .insert({
        workspace_id: workspaceId,
        source_platform: input.source_platform,
        source_url: input.source_url ?? null,
        source_external_id: `manual_${randomUUID()}`,
        author_name: input.author_name ?? null,
        content: input.content,
        rating: input.rating ?? null,
        source_date: input.source_date ?? new Date().toISOString(),
        processed: false,
      })
      .select('id')
      .single<{ id: string }>();
    if (error || !inserted) {
      throw new Error(`[v1/feedback POST] insert failed: ${error?.message ?? 'no row'}`);
    }

    await inngest.send({
      name: 'feedback/process',
      data: { rawFeedbackId: inserted.id, workspaceId },
    });

    return NextResponse.json(
      { raw_feedback_id: inserted.id, status: 'queued_for_analysis' },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError('v1/feedback POST', error);
  }
}
