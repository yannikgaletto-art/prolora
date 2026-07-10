import { getServiceDb } from '@/lib/db';
import { ApiError } from '@/lib/api/http';

// GDPR data export (Phase G). Collects all workspace-scoped data with
// EXPLICIT column allowlists per table — never select('*') — so encrypted
// tokens, embeddings and internal notes can never leak into an export.

export const GDPR_PAGE_SIZE = 1000;

// Secret-ish config keys are stripped recursively from feedback_sources.config.
const SECRET_KEY_PATTERN = /token|secret|key|password/i;

// Security gate patterns, applied to the serialized payload before responding.
const ENCRYPTED_VALUE_PATTERN = /(^|")v\d+:/;
const LIVE_API_KEY_PATTERN = /sk_live_/;
const EMBEDDING_KEY_PATTERN = /"embedding"\s*:/;

// Column allowlists — verified against supabase/migrations/001_initial_schema.sql.
// platform_connections: NO *_encrypted, no rate_limit_state, no last_health_check.
const COLUMNS = {
  platform_connections:
    'id, platform, account_name, account_type, status, created_at, last_used_at, scopes',
  post_groups:
    'id, original_content, media, scheduled_at, adapt_content, first_comment, created_via, created_at',
  post_items:
    'id, post_group_id, connection_id, platform, adapted_content, status, platform_post_id, platform_url, published_at, error_message, metrics, metrics_updated_at, created_at',
  // feedback_items: all analytical fields, EXCLUDING embedding + internal_notes.
  feedback_items:
    'id, source_platform, source_url, source_author, source_author_avatar, source_date, original_content, original_language, rating, sentiment, sentiment_score, category, summary_de, summary_en, topics, urgency, actionable, suggested_action, is_duplicate, duplicate_of, status, created_at',
  raw_feedback:
    'id, source_platform, source_url, author_name, content, rating, source_date, ingested_at',
  // submitted_by_email is allowed here: this is the workspace owner's own data export.
  board_items:
    'id, title, description, submitted_by_email, submitted_by_name, customer_tier, customer_mrr, vote_count, status, category, linked_feedback_ids, created_at, shipped_at',
  board_votes: 'id, board_item_id, voter_email, voter_fingerprint, created_at',
  changelog_entries:
    'id, title, content, ai_drafted, related_board_items, published_at, created_at',
  voice_configs:
    'id, name, tone, language, max_reply_length, include_personal_experience, avoid_patterns, example_replies, created_at',
  discovery_communities:
    'id, platform, community_name, community_url, member_count, activity_level, relevance_score, language, rules_summary, self_promo_policy, recommended_approach, top_questions, keywords, posting_cooldown_days, posts_this_week, week_reset_at, is_active, last_scanned_at, created_at',
  opportunity_threads:
    'id, community_id, platform, community_name, thread_title, thread_url, thread_external_id, thread_author, thread_body, posted_at, relevance_score, intent_type, intent_score, suggested_angle, status, draft_content, posted_content, posted_at_confirmed, cooldown_warning, response_map_match_id, engagement_upvotes, engagement_replies, created_at',
  response_map:
    'id, question_pattern, intent_type, best_answer, proof_asset_url, link_policy, times_used, avg_engagement, created_at',
  usage_logs: 'id, action, credits_used, metadata, created_at',
  feedback_sources: 'id, source_type, config, status, last_polled_at, last_poll_cursor, created_at',
} as const;

type Row = Record<string, unknown>;

interface TableExport {
  rows: Row[];
  total: number;
  truncated: boolean;
}

type PageQuery = PromiseLike<{
  data: Row[] | null;
  count: number | null;
  error: { message: string } | null;
}>;

export interface GdprExportResult {
  serialized: string;
  tableCount: number;
}

export async function buildGdprExport(workspaceId: string, page: number): Promise<GdprExportResult> {
  const db = getServiceDb();
  const offset = (page - 1) * GDPR_PAGE_SIZE;
  const rangeEnd = offset + GDPR_PAGE_SIZE - 1;

  // Direct workspace_id-scoped tables share one builder shape (Invariante 2).
  // raw_feedback has no created_at column — it orders by ingested_at instead.
  const workspaceScoped = (table: string, columns: string, orderColumn = 'created_at'): PageQuery =>
    db
      .from(table)
      .select(columns, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order(orderColumn, { ascending: true })
      .order('id', { ascending: true })
      .range(offset, rangeEnd)
      .returns<Row[]>();

  const [
    platformConnections,
    postGroups,
    postItems,
    feedbackItems,
    rawFeedback,
    boardItems,
    boardVotes,
    changelogEntries,
    voiceConfigs,
    discoveryCommunities,
    opportunityThreads,
    responseMap,
    usageLogs,
    feedbackSources,
  ] = await Promise.all([
    fetchTable('platform_connections', workspaceScoped('platform_connections', COLUMNS.platform_connections), offset),
    fetchTable('post_groups', workspaceScoped('post_groups', COLUMNS.post_groups), offset),
    // post_items carries no workspace_id — scope via inner join on the
    // workspace's post_groups, then drop the join artifact from the rows.
    fetchTable(
      'post_items',
      db
        .from('post_items')
        .select(`${COLUMNS.post_items}, post_groups!inner(workspace_id)`, { count: 'exact' })
        .eq('post_groups.workspace_id', workspaceId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, rangeEnd)
        .returns<Row[]>(),
      offset,
      ['post_groups']
    ),
    fetchTable('feedback_items', workspaceScoped('feedback_items', COLUMNS.feedback_items), offset),
    fetchTable('raw_feedback', workspaceScoped('raw_feedback', COLUMNS.raw_feedback, 'ingested_at'), offset),
    fetchTable('board_items', workspaceScoped('board_items', COLUMNS.board_items), offset),
    // board_votes carries no workspace_id — scope via the workspace's board_items.
    fetchTable(
      'board_votes',
      db
        .from('board_votes')
        .select(`${COLUMNS.board_votes}, board_items!inner(workspace_id)`, { count: 'exact' })
        .eq('board_items.workspace_id', workspaceId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, rangeEnd)
        .returns<Row[]>(),
      offset,
      ['board_items']
    ),
    fetchTable('changelog_entries', workspaceScoped('changelog_entries', COLUMNS.changelog_entries), offset),
    fetchTable('voice_configs', workspaceScoped('voice_configs', COLUMNS.voice_configs), offset),
    fetchTable('discovery_communities', workspaceScoped('discovery_communities', COLUMNS.discovery_communities), offset),
    fetchTable('opportunity_threads', workspaceScoped('opportunity_threads', COLUMNS.opportunity_threads), offset),
    fetchTable('response_map', workspaceScoped('response_map', COLUMNS.response_map), offset),
    fetchTable('usage_logs', workspaceScoped('usage_logs', COLUMNS.usage_logs), offset),
    fetchTable('feedback_sources', workspaceScoped('feedback_sources', COLUMNS.feedback_sources), offset),
  ]);

  // feedback_sources.config may hold connection settings — strip any key
  // containing token/secret/key/password before it can enter the export.
  feedbackSources.rows = feedbackSources.rows.map((row) => ({
    ...row,
    config: stripSecretKeys(row.config),
  }));

  const tables: Record<string, TableExport> = {
    platform_connections: platformConnections,
    post_groups: postGroups,
    post_items: postItems,
    feedback_items: feedbackItems,
    raw_feedback: rawFeedback,
    board_items: boardItems,
    board_votes: boardVotes,
    changelog_entries: changelogEntries,
    voice_configs: voiceConfigs,
    discovery_communities: discoveryCommunities,
    opportunity_threads: opportunityThreads,
    response_map: responseMap,
    usage_logs: usageLogs,
    feedback_sources: feedbackSources,
  };

  const payload = {
    workspace_id: workspaceId,
    exported_at: new Date().toISOString(),
    page,
    page_size: GDPR_PAGE_SIZE,
    truncated: Object.values(tables).some((t) => t.truncated),
    tables,
  };

  // Security gate: never respond if anything secret-shaped survived.
  const serialized = JSON.stringify(payload);
  if (ENCRYPTED_VALUE_PATTERN.test(serialized) || LIVE_API_KEY_PATTERN.test(serialized)) {
    console.error(`[gdpr] export blocked for workspace ${workspaceId}: secret pattern detected`);
    throw new ApiError(500, 'export blocked: potential secret detected', 'export_blocked');
  }
  if (EMBEDDING_KEY_PATTERN.test(serialized)) {
    console.error(`[gdpr] export blocked for workspace ${workspaceId}: embedding key detected`);
    throw new ApiError(500, 'export blocked: potential secret detected', 'export_blocked');
  }

  return { serialized, tableCount: Object.keys(tables).length };
}

async function fetchTable(
  table: string,
  query: PageQuery,
  offset: number,
  dropKeys: string[] = []
): Promise<TableExport> {
  const { data, count, error } = await query;
  if (error) {
    throw new Error(`[gdpr] ${table} query failed: ${error.message}`);
  }
  let rows = data ?? [];
  if (dropKeys.length > 0) {
    rows = rows.map((row) => {
      const clean: Row = { ...row };
      for (const key of dropKeys) delete clean[key];
      return clean;
    });
  }
  const total = count ?? rows.length;
  return { rows, total, truncated: offset + rows.length < total };
}

// Recursively removes any object key containing token/secret/key/password.
function stripSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecretKeys);
  }
  if (value !== null && typeof value === 'object') {
    const clean: Row = {};
    for (const [key, nested] of Object.entries(value as Row)) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      clean[key] = stripSecretKeys(nested);
    }
    return clean;
  }
  return value;
}
