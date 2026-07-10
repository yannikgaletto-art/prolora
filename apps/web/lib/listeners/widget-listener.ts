import { randomUUID } from 'node:crypto';
import { getServiceDb, type FeedbackSourceRow } from '@/lib/db';
import { inngest } from '@/lib/inngest/client';
import { ApiError } from '@/lib/api/http';

// DB-side rate limit (Vercel cold starts make in-memory counters useless):
// max 50 widget submissions per workspace per rolling hour.
const RATE_LIMIT_PER_HOUR = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const WIDGET_RETRY_AFTER_SECONDS = 3600;

export interface WidgetSubmission {
  content: string;
  email?: string;
  // NOTE: raw_feedback has no category column and the analyze pipeline
  // classifies anyway — category is accepted but intentionally dropped.
  category?: string;
  rating?: number;
}

export interface WidgetIngestResult {
  rawFeedbackId: string;
}

// Resolve a workspace by its public slug. Used by the unauthenticated widget
// endpoint — the slug is the only tenant identifier the widget knows.
export async function resolveWorkspaceBySlug(slug: string): Promise<{ id: string } | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspaces')
    .select('id')
    .eq('slug', slug)
    .maybeSingle<{ id: string }>();
  if (error) {
    console.error(`[listener:widget] workspace lookup failed: ${error.message}`);
    throw new ApiError(500, 'Feedback intake temporarily unavailable.', 'lookup_failed');
  }
  return data;
}

// The workspace's widget feedback_source (if configured) — carries
// config.allowed_origins for CORS and becomes raw_feedback.source_id.
export async function findWidgetSource(workspaceId: string): Promise<FeedbackSourceRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('feedback_sources')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('source_type', 'widget')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .returns<FeedbackSourceRow[]>();
  if (error) {
    // CORS/source linkage is best-effort — never block feedback intake.
    console.error(`[listener:widget] widget source lookup failed: ${error.message}`);
    return null;
  }
  return data?.[0] ?? null;
}

export function allowedOriginsFromSource(source: FeedbackSourceRow | null): string[] | null {
  const raw = source?.config?.allowed_origins;
  if (!Array.isArray(raw)) return null;
  const origins = raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return origins.length > 0 ? origins : null;
}

// Validated submission -> DB rate-limit check -> durable insert ->
// 'feedback/process' event. Throws ApiError(429) when the workspace exceeded
// its hourly widget budget.
export async function ingestWidgetFeedback(
  workspaceId: string,
  source: FeedbackSourceRow | null,
  submission: WidgetSubmission
): Promise<WidgetIngestResult> {
  const db = getServiceDb();

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countError } = await db
    .from('raw_feedback')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('source_platform', 'widget')
    .gt('ingested_at', windowStart);
  if (countError) {
    console.error(`[listener:widget] rate limit check failed: ${countError.message}`);
    throw new ApiError(500, 'Feedback intake temporarily unavailable.', 'rate_check_failed');
  }
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    console.error(
      `[listener:widget] rate limit hit for workspace ${workspaceId} (${count}/${RATE_LIMIT_PER_HOUR} per hour)`
    );
    throw new ApiError(429, 'Too many feedback submissions. Please try again later.', 'rate_limited');
  }

  // Durable write FIRST (Invariante 4). Schema reality: raw_feedback has no
  // email column — the submitter email is stored in author_name.
  const { data: inserted, error } = await db
    .from('raw_feedback')
    .insert({
      workspace_id: workspaceId,
      source_id: source?.id ?? null,
      source_platform: 'widget',
      source_url: null,
      source_external_id: randomUUID(),
      author_name: submission.email ?? null,
      author_avatar: null,
      content: submission.content,
      rating: submission.rating ?? null,
      source_date: new Date().toISOString(),
      processed: false,
    })
    .select('id')
    .single<{ id: string }>();
  if (error || !inserted) {
    console.error(`[listener:widget] insert failed: ${error?.message ?? 'no row returned'}`);
    throw new ApiError(500, 'Could not save your feedback. Please try again.', 'insert_failed');
  }

  // Analysis is async and best-effort here: the raw feedback is already
  // durable, batch-process sweeps up anything whose event send failed.
  try {
    await inngest.send({
      name: 'feedback/process',
      data: { rawFeedbackId: inserted.id, workspaceId },
    });
  } catch (sendError) {
    console.error(
      `[listener:widget] feedback/process event failed: ${sendError instanceof Error ? sendError.message : String(sendError)}`
    );
  }

  console.log(`[listener:widget] ingested feedback ${inserted.id} for workspace ${workspaceId}`);
  return { rawFeedbackId: inserted.id };
}
