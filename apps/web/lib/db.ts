import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServiceClient } from '@/lib/supabase/server';

// Service-role client bypasses RLS — every query MUST scope by explicit
// workspace_id / connection id (Invariante 2).
export function getServiceDb(): SupabaseClient {
  return createSupabaseServiceClient() as SupabaseClient;
}

// --- Row types for the tables this backend touches ---
// (No generated Database types yet; these mirror supabase/migrations/001.)

export interface ConnectionRow {
  id: string;
  workspace_id: string;
  platform: 'linkedin' | 'x' | 'bluesky' | 'mastodon' | 'telegram';
  account_name: string;
  account_id: string | null;
  account_type: string;
  avatar_url: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  app_password_encrypted: string | null;
  bot_token_encrypted: string | null;
  scopes: string[] | null;
  status: 'active' | 'expired' | 'revoked' | 'error';
  config: Record<string, unknown>;
  last_used_at: string | null;
  last_health_check: Record<string, unknown> | null;
  rate_limit_state: Record<string, unknown>;
  refresh_locked_until: string | null;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  workspace_id: string;
  key_hash: string;
  key_prefix: string;
  name: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface MastodonInstanceRow {
  id: string;
  instance_url: string;
  client_id: string;
  client_secret_encrypted: string;
  created_at: string;
}

export interface PostGroupRow {
  id: string;
  workspace_id: string;
  original_content: string;
  media: MediaRef[];
  scheduled_at: string | null;
  /** IANA zone the schedule was authored in (007) — display stays stable across DST/viewers. */
  scheduled_tz: string | null;
  adapt_content: boolean;
  first_comment: string | null;
  /** Pillar this group was splintered from (008), if any. */
  content_source_id: string | null;
  created_at: string;
  created_via: 'api' | 'mcp' | 'dashboard';
}

// Media reference stored in post_groups.media — always the Storage KEY,
// never a signed URL (Invariante 6 / Risiko R2).
export interface MediaRef {
  type: 'image' | 'video' | 'document';
  storage_key: string;
  mime_type: string;
  alt_text?: string;
}

export interface PostItemRow {
  id: string;
  post_group_id: string;
  connection_id: string;
  platform: 'linkedin' | 'x' | 'bluesky' | 'mastodon' | 'telegram';
  adapted_content: string | null;
  resolved_content: string | null;
  media: MediaRef[];
  status: 'draft' | 'queued' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'deleted';
  platform_post_id: string | null;
  platform_url: string | null;
  published_at: string | null;
  error_message: string | null;
  metrics: Record<string, unknown>;
  metrics_updated_at: string | null;
  created_at: string;
}

export interface RawFeedbackRow {
  id: string;
  workspace_id: string;
  source_id: string | null;
  source_platform: string;
  source_url: string | null;
  source_external_id: string | null;
  author_name: string | null;
  author_avatar: string | null;
  content: string;
  rating: number | null;
  source_date: string | null;
  ingested_at: string;
  processed: boolean;
}

export interface FeedbackItemRow {
  id: string;
  workspace_id: string;
  source_platform: string;
  source_url: string | null;
  source_author: string | null;
  source_author_avatar: string | null;
  source_date: string | null;
  original_content: string;
  original_language: string | null;
  rating: number | null;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed' | null;
  sentiment_score: number | null;
  category: 'bug' | 'feature_request' | 'praise' | 'complaint' | 'question' | 'other' | null;
  summary_de: string | null;
  summary_en: string | null;
  topics: string[] | null;
  urgency: 'low' | 'medium' | 'high' | 'critical' | null;
  actionable: boolean;
  suggested_action: string | null;
  is_duplicate: boolean;
  duplicate_of: string | null;
  embedding: string | null;
  status: 'new' | 'reviewed' | 'actioned' | 'archived';
  internal_notes: string | null;
  created_at: string;
}

export interface WebhookRow {
  id: string;
  workspace_id: string;
  url: string;
  events: string[];
  secret_encrypted: string;
  active: boolean;
  last_triggered_at: string | null;
  failure_count: number;
  created_at: string;
}

export interface WorkspaceContextRow {
  id: string;
  workspace_id: string;
  website_url: string | null;
  product_description: string | null;
  target_audience: string | null;
  suggested_keywords: string[];
  voice_tone: string;
  voice_language: string;
  confidence: number | null;
  last_updated_at: string;
  created_at: string;
}

export interface DiscoveryCommunityRow {
  id: string;
  workspace_id: string;
  platform: string;
  community_name: string;
  community_url: string | null;
  member_count: number | null;
  activity_level: string | null;
  relevance_score: number | null;
  language: string;
  rules_summary: string | null;
  self_promo_policy: string | null;
  recommended_approach: string | null;
  top_questions: string[];
  keywords: string[];
  posting_cooldown_days: number;
  posts_this_week: number;
  week_reset_at: string;
  is_active: boolean;
  last_scanned_at: string | null;
  created_at: string;
}

export interface OpportunityThreadRow {
  id: string;
  workspace_id: string;
  community_id: string | null;
  platform: string;
  community_name: string;
  thread_title: string;
  thread_url: string;
  thread_external_id: string | null;
  thread_author: string | null;
  thread_body: string | null;
  posted_at: string | null;
  relevance_score: number | null;
  intent_type: string | null;
  intent_score: number;
  suggested_angle: string | null;
  status: 'new' | 'drafted' | 'posted' | 'skipped' | 'expired';
  draft_content: string | null;
  posted_content: string | null;
  posted_at_confirmed: string | null;
  cooldown_warning: string | null;
  response_map_match_id: string | null;
  engagement_upvotes: number | null;
  engagement_replies: number | null;
  created_at: string;
}

export interface ResponseMapRow {
  id: string;
  workspace_id: string;
  question_pattern: string;
  intent_type: string | null;
  best_answer: string;
  proof_asset_url: string | null;
  link_policy: 'never' | 'if_asked' | 'in_followup';
  times_used: number;
  avg_engagement: number;
  created_at: string;
}

export interface VoiceConfigRow {
  id: string;
  workspace_id: string;
  name: string;
  tone: string;
  language: string;
  max_reply_length: number;
  include_personal_experience: boolean;
  avoid_patterns: string[];
  example_replies: string[];
  created_at: string;
}

export interface FeedbackSourceRow {
  id: string;
  workspace_id: string;
  source_type: string;
  config: Record<string, unknown>;
  status: string;
  last_polled_at: string | null;
  last_poll_cursor: string | null;
  created_at: string;
}

export interface BoardItemRow {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  submitted_by_email: string | null;
  submitted_by_name: string | null;
  customer_tier: string | null;
  customer_mrr: number | null;
  vote_count: number;
  status: 'open' | 'planned' | 'in_progress' | 'shipped' | 'declined';
  category: string | null;
  linked_feedback_ids: string[] | null;
  created_at: string;
  shipped_at: string | null;
}

export interface BoardVoteRow {
  id: string;
  board_item_id: string;
  voter_email: string | null;
  voter_fingerprint: string | null;
  created_at: string;
}

export interface ChangelogEntryRow {
  id: string;
  workspace_id: string;
  title: string;
  content: string;
  ai_drafted: boolean;
  related_board_items: string[] | null;
  published_at: string | null;
  created_at: string;
}

// --- GOAL-RUN6: Splinter engine + AI media generation (migration 008) ---

export interface ContentSourceRow {
  id: string;
  workspace_id: string;
  kind: 'paste' | 'url' | 'editor';
  title: string | null;
  body_md: string;
  source_url: string | null;
  /** SplinterSuggestion[] from @prolora/shared, stored as JSONB. */
  splinters: unknown[];
  splintered_at: string | null;
  status: 'new' | 'splintered' | 'archived';
  created_at: string;
}

export interface MediaGenerationRow {
  id: string;
  workspace_id: string;
  kind: 'image' | 'video';
  prompt: string;
  format: 'square' | 'portrait' | 'landscape';
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  provider: string;
  model: string;
  provider_job_id: string | null;
  storage_key: string | null;
  mime_type: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface MediaBudgetLedgerRow {
  id: string;
  workspace_id: string;
  generation_id: string;
  month: string;
  estimated_eur: number;
  final_eur: number | null;
  state: 'reserved' | 'committed' | 'released';
  provider: string;
  model: string;
  created_at: string;
  updated_at: string;
}
