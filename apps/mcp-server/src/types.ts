// Local response types — mirror what the Prolora REST API actually returns
// on the wire (never raw DB rows: encrypted/internal fields are stripped
// server-side before these shapes reach the MCP server).

export type Platform = 'linkedin' | 'x' | 'bluesky' | 'mastodon' | 'telegram';
export type PostStatus = 'queued' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'deleted';
export type FeedbackSentiment = 'positive' | 'negative' | 'neutral' | 'mixed';
export type FeedbackCategory = 'bug' | 'feature_request' | 'praise' | 'complaint' | 'question' | 'other';
export type FeedbackUrgency = 'low' | 'medium' | 'high' | 'critical';
export type FeedbackStatus = 'new' | 'reviewed' | 'actioned' | 'archived';
export type OpportunityStatus = 'new' | 'drafted' | 'posted' | 'skipped' | 'expired';
export type VoiceTone = 'casual' | 'professional' | 'technical' | 'empathetic';

// --- Publishing ---

export interface PostItemStatus {
  platform: string;
  connection_id: string;
  status: PostStatus;
  platform_post_id?: string;
  platform_url?: string;
  published_at?: string;
  error?: string;
}

export interface CreatePostResponse {
  post_group_id: string;
  items: PostItemStatus[];
  credits_used: number;
  warnings?: string[];
}

export interface PostItemRow {
  id: string;
  post_group_id: string;
  connection_id: string;
  platform: Platform;
  adapted_content: string | null;
  status: PostStatus;
  platform_post_id: string | null;
  platform_url: string | null;
  published_at: string | null;
  error_message: string | null;
  metrics: Record<string, unknown>;
  created_at: string;
}

export interface PostGroup {
  id: string;
  workspace_id: string;
  original_content: string;
  scheduled_at: string | null;
  first_comment: string | null;
  created_at: string;
  created_via: 'api' | 'mcp' | 'dashboard';
  post_items: PostItemRow[];
}

export interface ListPostsResponse {
  posts: PostGroup[];
  page: number;
  per_page: number;
  total: number;
}

export interface DeletePostResponse {
  post_group_id: string;
  items: Array<{ item_id: string; deleted: boolean; note?: string }>;
}

export interface RetryPostResponse {
  post_group_id: string;
  retried: number;
}

export interface ContentAdaptation {
  platform: string;
  content: string;
  adapted: boolean;
  warning?: string;
}

export interface AdaptContentResponse {
  adaptations: ContentAdaptation[];
}

export interface Connection {
  connection_id: string;
  platform: Platform;
  account_name: string;
  account_type: string;
  avatar_url?: string;
  connected_at: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
}

export interface ListConnectionsResponse {
  connections: Connection[];
}

// --- Listening ---

export interface FeedbackItem {
  id: string;
  workspace_id: string;
  source_platform: string;
  source_url: string | null;
  source_author: string | null;
  source_date: string | null;
  original_content: string;
  rating: number | null;
  sentiment: FeedbackSentiment | null;
  sentiment_score: number | null;
  category: FeedbackCategory | null;
  summary_de: string | null;
  summary_en: string | null;
  topics: string[] | null;
  urgency: FeedbackUrgency | null;
  actionable: boolean;
  suggested_action: string | null;
  is_duplicate: boolean;
  status: FeedbackStatus;
  created_at: string;
}

export interface ListFeedbackResponse {
  feedback: FeedbackItem[];
  page: number;
  per_page: number;
  total: number;
}

export interface AskFeedbackResponse {
  answer: string;
  confidence: number;
  based_on_count: number;
  key_quotes: string[];
  credits_used: number;
}

export interface FeedbackSummaryResponse {
  period: string;
  total_feedback: number;
  by_sentiment: Record<FeedbackSentiment, number>;
  by_category: Record<string, number>;
  by_platform: Record<string, number>;
  sentiment_trend: Array<{ date: string; avg_score: number; count: number }>;
  top_topics: Array<{ topic: string; count: number; avg_sentiment: number }>;
  urgent_unresolved: number;
  ai_executive_summary: string;
}

export interface MarkFeedbackResponse {
  feedback: FeedbackItem;
  shipped_board_items?: string[];
}

// --- Discovery ---

export interface DiscoveredCommunity {
  id?: string;
  platform: string;
  name?: string;
  community_name?: string;
  url?: string;
  community_url?: string | null;
  member_count: number | null;
  activity_level: string | null;
  relevance_score: number | null;
  language: string;
  rules_summary: string | null;
  self_promo_policy?: string | null;
  recommended_approach: string | null;
  top_recurring_questions?: string[];
}

export interface DiscoverCommunitiesResponse {
  communities: DiscoveredCommunity[];
  total: number;
}

export interface AutoContextResponse {
  product_description: string;
  target_audience: string;
  suggested_keywords: string[];
  suggested_voice: { tone: string; language: string; example_phrases: string[] };
  confidence: number;
}

export interface Opportunity {
  id: string;
  platform: string;
  community_name: string;
  thread_title: string;
  thread_url: string;
  thread_author: string | null;
  posted_at: string | null;
  relevance_score: number | null;
  intent_type: string | null;
  intent_score: number;
  suggested_angle: string | null;
  status: OpportunityStatus;
  draft_content: string | null;
  cooldown_warning: string | null;
  created_at: string;
}

export interface ListOpportunitiesResponse {
  opportunities: Opportunity[];
  page: number;
  per_page: number;
  total: number;
}

export interface DraftReplyResponse {
  draft_id: string;
  content: string;
  reasoning: string;
  community_rules_check: { compliant: boolean; warnings: string[] };
  suggested_follow_up?: string;
}

export interface ConfirmPostedResponse {
  opportunity_id: string;
  status: 'posted';
  posted_at_confirmed: string;
}

export interface ReuseContentResponse {
  adapted_title: string;
  adapted_content: string;
  differences_from_original: string;
  recommended_posting_time: string;
  cooldown_warning?: string;
}

export interface ResponseMapEntry {
  id: string;
  question_pattern: string;
  intent_type: string | null;
  best_answer: string;
  proof_asset_url: string | null;
  link_policy: 'never' | 'if_asked' | 'in_followup';
  times_used: number;
  avg_engagement: number;
}

export interface GetResponseMapResponse {
  entries: ResponseMapEntry[];
}

export interface AddResponseMapEntryResponse {
  entry: ResponseMapEntry;
}

export interface VoiceConfig {
  id: string;
  tone: VoiceTone;
  language: string;
  max_reply_length: number;
  include_personal_experience: boolean;
  avoid_patterns: string[];
  example_replies: string[];
}

export interface GetVoiceConfigResponse {
  voice_config: VoiceConfig;
}

// --- Templates (GOAL-RUN4) ---

export interface TemplateSlot {
  key: string;
  question: string;
  placeholder?: string;
  required: boolean;
  prefill_from?: 'product_description' | 'target_audience';
}

export interface PostTemplateSummary {
  id: string;
  name: string;
  description: string;
  intent: string;
  post_type: string;
  psych_levels: string[];
  structure: string[];
  hook_formulas: string[];
  cta_mechanic: string;
  style_preset: string;
  format: string;
  recommended_platforms: Platform[];
  slots: TemplateSlot[];
  manual_steps?: string[];
}

export interface TemplateListResponse {
  templates: PostTemplateSummary[];
  context_available: boolean;
  ai_enabled: boolean;
}

export interface TemplateDraftResponse {
  template_id: string;
  draft: {
    content: string;
    first_comment?: string;
    slides?: string[];
    manual_steps?: string[];
    recommended_platforms: Platform[];
  };
  credits_used: number;
}
