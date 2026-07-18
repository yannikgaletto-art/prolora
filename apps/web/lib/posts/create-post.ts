import type {
  CreatePostRequest,
  CreatePostResponse,
  MediaItem,
  PostItemStatus,
} from '@prolora/shared';
import { PLAN_LIMITS, type PlanType } from '@prolora/shared';
import { CONNECTION_ROW_COLUMNS, POST_ITEM_ROW_COLUMNS, getServiceDb, type ConnectionRow, type MediaRef, type PostItemRow } from '@/lib/db';
import { ingestMedia } from '@/lib/media/transform';
import { adaptContentForPlatforms, type PlatformTarget } from '@/lib/ai/adapt-content';
import { validateForPlatform, validateScheduledAt } from '@/lib/validation/pipeline';
import { getPlatformRules } from '@/lib/validation/platform-rules';
import { inngest } from '@/lib/inngest/client';
import { ApiError } from '@/lib/api/http';
import { resolveConnectionPayload } from './resolve-payload';
import { hashScoredContent } from '@/lib/scoring/content-hash';
import { linkLatestPrediction } from '@/lib/scoring/prediction-store';

export interface CreatePostResult {
  response: CreatePostResponse;
  warnings: string[];
}

// The main publishing entry (FABLE-02 Abschnitt 2):
// media ingest -> adaptation -> validation -> durable write (Double
// Assurance) -> Inngest events -> response.
// Auth + Zod parsing happen in the route; this service assumes a verified
// workspaceId and a schema-valid request.
export async function createPost(
  workspaceId: string,
  request: CreatePostRequest,
  createdVia: 'api' | 'mcp' | 'dashboard' = 'api',
  options: { contentSourceId?: string } = {}
): Promise<CreatePostResult> {
  const db = getServiceDb();
  const warnings: string[] = [];
  // Drafts (GOAL-RUN6): persist without publishing. Validation problems are
  // demoted to warnings (the user will edit before scheduling), the monthly
  // post quota applies when the draft is converted, never on save.
  const isDraft = request.draft === true;

  // platform_overrides.media has no durable home yet (post_items carries
  // only adapted_content) — reject instead of silently dropping it.
  for (const [platform, override] of Object.entries(request.platform_overrides ?? {})) {
    if (override.media && override.media.length > 0) {
      throw new ApiError(
        400,
        `platform_overrides.${platform}.media is not supported yet — use the post-level media field`,
        'unsupported_override'
      );
    }
  }

  // scheduled_at sanity (not past, max 60 days out)
  const scheduleErrors = validateScheduledAt(request.scheduled_at);
  if (scheduleErrors.length > 0) {
    throw new ApiError(400, scheduleErrors.join('; '), 'invalid_schedule');
  }

  // Resolve connections — MUST belong to this workspace (Invariante 2).
  const connections = await loadConnections(workspaceId, request.platforms);

  // Monthly post quota (per plan) — checked BEFORE any write. Drafts are
  // exempt; the schedule endpoint re-checks when a draft turns publishable.
  if (!isDraft) {
    await assertPostQuota(workspaceId, connections.length);
  }

  // Media: external URLs -> private storage, keys only (Invariante 6).
  const mediaRefs = request.media?.length ? await ingestMedia(workspaceId, request.media) : [];

  // Content adaptation (optional) — parallel, falls back to original.
  const contentByConnection = new Map<string, string>();
  if (request.adapt_content) {
    const targets: PlatformTarget[] = connections.map((c) => ({
      platform: c.platform,
      characterLimit: characterLimitFor(c),
    }));
    const adapted = await adaptContentForPlatforms(workspaceId, request.content, targets);
    for (const c of connections) {
      const match = adapted.find((a) => a.platform === c.platform);
      if (match) {
        contentByConnection.set(c.id, match.content);
        if (match.warning) warnings.push(match.warning);
      }
    }
  }

  // Per-platform overrides beat adaptation, adaptation beats the original.
  const finalContent = (c: ConnectionRow): string =>
    resolveConnectionPayload({
      connectionId: c.id,
      content:
        request.platform_overrides?.[c.platform]?.content ??
        contentByConnection.get(c.id) ??
        request.content,
      media: request.media ?? [],
      connectionOverrides: request.connection_overrides,
    }).content;

  const mediaByConnection = new Map<string, MediaRef[]>();
  for (const connection of connections) {
    const override = request.connection_overrides?.[connection.id];
    mediaByConnection.set(
      connection.id,
      override?.media ? await ingestMedia(workspaceId, override.media) : mediaRefs
    );
  }

  // Smart validation per platform — errors abort with 400 + details.
  const validationErrors: string[] = [];
  for (const connection of connections) {
    const mediaItems: MediaItem[] = (mediaByConnection.get(connection.id) ?? []).map((ref) => ({
      type: ref.type,
      url: ref.storage_key,
      alt_text: ref.alt_text,
      mime_type: ref.mime_type,
    }));
    const result = validateForPlatform({
      connection,
      content: finalContent(connection),
      media: mediaItems,
    });
    validationErrors.push(...result.errors.map((e) => `[${connection.platform}] ${e}`));
    warnings.push(...result.warnings.map((w) => `[${connection.platform}] ${w}`));
  }
  if (validationErrors.length > 0) {
    if (isDraft) {
      // A draft must be savable even when it would not publish as-is — the
      // problems surface as warnings and again (as errors) at schedule time.
      warnings.push(...validationErrors.map((e) => `[draft] ${e}`));
    } else {
      throw new ApiError(400, validationErrors.join('; '), 'validation_failed');
    }
  }

  // Durable write: post_group -> post_items -> read-back verify.
  const isScheduled = Boolean(request.scheduled_at);
  const { data: group, error: groupError } = await db
    .from('post_groups')
    .insert({
      workspace_id: workspaceId,
      original_content: request.content,
      media: mediaRefs,
      scheduled_at: request.scheduled_at ?? null,
      scheduled_tz: request.scheduled_tz ?? null,
      adapt_content: request.adapt_content ?? false,
      first_comment: request.first_comment ?? null,
      content_source_id: options.contentSourceId ?? null,
      created_via: createdVia,
    })
    .select('id')
    .single<{ id: string }>();
  if (groupError || !group) {
    throw new Error(`[create-post] post_group insert failed: ${groupError?.message ?? 'no row'}`);
  }

  const itemsPayload = connections.map((c) => ({
    post_group_id: group.id,
    connection_id: c.id,
    platform: c.platform,
    adapted_content: finalContent(c) === request.content ? null : finalContent(c),
    resolved_content: finalContent(c),
    media: mediaByConnection.get(c.id) ?? mediaRefs,
    status: isDraft ? 'draft' : isScheduled ? 'scheduled' : 'queued',
  }));
  const { error: itemsError } = await db.from('post_items').insert(itemsPayload);
  if (itemsError) {
    throw new Error(`[create-post] post_items insert failed: ${itemsError.message}`);
  }

  // Read-back (Double Assurance): every platform row must exist.
  const { data: items, error: readBackError } = await db
    .from('post_items')
    .select(POST_ITEM_ROW_COLUMNS)
    .eq('post_group_id', group.id)
    .returns<PostItemRow[]>();
  if (readBackError || !items || items.length !== connections.length) {
    throw new Error(
      `[create-post] write verification failed: expected ${connections.length} items, got ${items?.length ?? 0}`
    );
  }

  for (const item of items) {
    try {
      await linkLatestPrediction({
        workspaceId,
        platform: item.platform,
        contentHash: hashScoredContent(item.resolved_content ?? request.content),
        postGroupId: group.id,
        postItemId: item.id,
      });
    } catch (predictionError) {
      console.error('[impact] prediction stamp failed:', predictionError);
    }
  }

  // Usage log (post creation is quota-relevant).
  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'post_created',
    credits_used: 0,
    metadata: { post_group_id: group.id, platforms: connections.map((c) => c.platform) },
  });
  if (usageError) {
    console.error('[create-post] usage log failed:', usageError.message);
  }

  // Immediate posts: fan out publish events now. Scheduled posts are picked
  // up by the publish-scheduled cron when due. Drafts NEVER emit events —
  // the sweep only selects status='scheduled', so a draft cannot publish.
  if (!isScheduled && !isDraft) {
    await inngest.send(
      items.map((item) => ({
        name: 'post/publish' as const,
        data: { postItemId: item.id, workspaceId },
      }))
    );
  }

  const itemStatuses: PostItemStatus[] = items.map((item) => ({
    platform: item.platform,
    connection_id: item.connection_id,
    status: item.status,
  }));

  return {
    response: {
      post_group_id: group.id,
      items: itemStatuses,
      credits_used: 0,
    },
    warnings,
  };
}

async function loadConnections(
  workspaceId: string,
  connectionIds: string[]
): Promise<ConnectionRow[]> {
  const db = getServiceDb();
  const unique = [...new Set(connectionIds)];
  const { data, error } = await db
    .from('platform_connections')
    .select(CONNECTION_ROW_COLUMNS)
    .eq('workspace_id', workspaceId)
    .in('id', unique)
    .returns<ConnectionRow[]>();

  if (error) {
    throw new Error(`[create-post] connection lookup failed: ${error.message}`);
  }
  const found = data ?? [];
  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((c) => c.id));
    const missing = unique.filter((id) => !foundIds.has(id));
    throw new ApiError(
      404,
      `Unknown connection(s) for this workspace: ${missing.join(', ')}`,
      'connection_not_found'
    );
  }
  return found;
}

// Exported: the schedule endpoint re-checks quota when drafts turn publishable.
export async function assertPostQuota(workspaceId: string, newPosts: number): Promise<void> {
  const db = getServiceDb();
  const { data: workspace, error } = await db
    .from('workspaces')
    .select('plan')
    .eq('id', workspaceId)
    .single<{ plan: PlanType }>();
  if (error || !workspace) {
    throw new Error(`[create-post] workspace lookup failed: ${error?.message ?? 'not found'}`);
  }

  const limit = PLAN_LIMITS[workspace.plan]?.max_posts_per_month ?? PLAN_LIMITS.starter.max_posts_per_month;
  if (!Number.isFinite(limit)) return; // agency: unlimited

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const { count, error: countError } = await db
    .from('post_items')
    .select('id, post_groups!inner(workspace_id)', { count: 'exact', head: true })
    .eq('post_groups.workspace_id', workspaceId)
    .gte('created_at', monthStart.toISOString());
  if (countError) {
    throw new Error(`[create-post] quota count failed: ${countError.message}`);
  }

  if ((count ?? 0) + newPosts > limit) {
    throw new ApiError(
      402,
      `Monthly post limit reached (${count}/${limit} on the ${workspace.plan} plan).`,
      'quota_exceeded'
    );
  }
}

export function characterLimitFor(connection: ConnectionRow): number {
  if (connection.platform === 'mastodon') {
    const limit = connection.config?.max_characters;
    if (typeof limit === 'number' && limit > 0) return limit;
  }
  return getPlatformRules(connection.platform).max_text_length;
}

export type { MediaRef };
