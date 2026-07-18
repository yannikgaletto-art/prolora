// ============================================================
// Prolora — Shared Type Definitions
// Single Source of Truth for all TypeScript interfaces
// ============================================================

// --- Platform Types ---

export type PlatformType = 'linkedin' | 'x' | 'bluesky' | 'mastodon' | 'telegram';

export type PlatformPhase2 = 'instagram' | 'facebook' | 'threads' | 'tiktok' | 'youtube';

export type AllPlatforms = PlatformType | PlatformPhase2;

export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

export type AccountType = 'personal' | 'business' | 'creator' | 'page' | 'bot';

// --- Publishing Types ---

export type PostStatus =
  | 'draft'
  | 'queued'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'deleted';

export type PostCreationSource = 'api' | 'mcp' | 'dashboard';

export interface CreatePostRequest {
  content: string;
  platforms: string[];
  media?: MediaItem[];
  platform_overrides?: Record<string, {
    content?: string;
    media?: { url: string; alt_text?: string }[];
  }>;
  connection_overrides?: Record<string, {
    content?: string;
    media?: MediaItem[];
  }>;
  scheduled_at?: string;
  /** IANA zone the schedule was authored in (e.g. 'Europe/Berlin'). */
  scheduled_tz?: string;
  /** true: save only — items get status 'draft', nothing is ever published
   *  without a later explicit action (GOAL-RUN6 Kalender). */
  draft?: boolean;
  first_comment?: string;
  adapt_content?: boolean;
  evergreen?: boolean;
  workspace_id?: string;
}

export interface MediaItem {
  type: 'image' | 'video' | 'document';
  url: string;
  alt_text?: string;
  mime_type?: string;
}

export interface CreatePostResponse {
  post_group_id: string;
  items: PostItemStatus[];
  credits_used: number;
}

export interface PostItemStatus {
  platform: string;
  connection_id: string;
  status: PostStatus;
  platform_post_id?: string;
  platform_url?: string;
  published_at?: string;
  error?: string;
  metrics?: PostMetrics;
}

export interface PostMetrics {
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
}

// --- Platform Adapter Types ---

export interface PublishParams {
  content: string;
  media?: MediaItem[];
  connection_id: string;
  post_item_id: string;
}

export interface PublishResult {
  success: boolean;
  platform_post_id?: string;
  platform_url?: string;
  error?: PlatformError;
}

export interface CommentParams {
  platform_post_id: string;
  comment_text: string;
  connection_id: string;
}

export interface CommentResult {
  success: boolean;
  comment_id?: string;
  error?: PlatformError;
}

export enum PlatformErrorType {
  AUTH_EXPIRED = 'auth_expired',
  AUTH_REVOKED = 'auth_revoked',
  RATE_LIMITED = 'rate_limited',
  CONTENT_REJECTED = 'content_rejected',
  PLATFORM_DOWN = 'platform_down',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown',
}

export interface PlatformError {
  type: PlatformErrorType;
  message: string;
  retryable: boolean;
  retry_after?: number;
  raw_status?: number;
  raw_body?: string;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  reset_at: string;
}

export interface MetricsResult {
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
}

// --- Validation Types ---

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export interface ValidationReport {
  overall_valid: boolean;
  platforms: Record<string, ValidationResult>;
}

export interface PlatformRules {
  max_text_length: number;
  text_count_mode?: 'character' | 'grapheme';
  max_text_length_dynamic?: boolean;
  supports_text_only: boolean;
  supports_images: boolean;
  max_images?: number;
  max_image_size_mb?: number;
  supports_video: boolean;
  max_video_size_mb?: number;
  supports_documents: boolean;
  max_document_size_mb?: number;
  supported_image_formats: string[];
  supported_video_formats?: string[];
  min_aspect_ratio?: number;
  max_aspect_ratio?: number;
  supports_poll: boolean;
  max_poll_options?: number;
  supports_first_comment: boolean;
  supports_link_preview: boolean;
  supports_thread: boolean;
  max_thread_tweets?: number;
  supports_carousel: boolean;
  max_carousel_items?: number;
  supports_content_warning?: boolean;
}

// --- Feedback Types ---

export type FeedbackSentiment = 'positive' | 'negative' | 'neutral' | 'mixed';

export type FeedbackCategory = 'bug' | 'feature_request' | 'praise' | 'complaint' | 'question' | 'other';

export type FeedbackUrgency = 'low' | 'medium' | 'high' | 'critical';

export type FeedbackStatus = 'new' | 'reviewed' | 'actioned' | 'archived';

export type BoardItemStatus = 'open' | 'planned' | 'in_progress' | 'shipped' | 'declined';

export interface FeedbackAnalysis {
  sentiment: FeedbackSentiment;
  sentiment_score: number;
  language: string;
  category: FeedbackCategory;
  summary_de: string;
  summary_en: string;
  topics: string[];
  urgency: FeedbackUrgency;
  actionable: boolean;
  suggested_action: string | null;
}

export interface FeedbackQueryParams {
  workspace_id: string;
  platform?: string;
  sentiment?: FeedbackSentiment;
  category?: FeedbackCategory;
  urgency?: FeedbackUrgency;
  date_from?: string;
  date_to?: string;
  search?: string;
  is_duplicate?: boolean;
  page?: number;
  per_page?: number;
}

export interface FeedbackSummaryResponse {
  period: string;
  total_feedback: number;
  by_sentiment: Record<FeedbackSentiment, number>;
  by_category: Record<string, number>;
  by_platform: Record<string, number>;
  sentiment_trend: { date: string; avg_score: number; count: number }[];
  top_topics: { topic: string; count: number; avg_sentiment: number }[];
  top_feature_requests: { summary: string; count: number; sources: string[] }[];
  urgent_unresolved: number;
  ai_executive_summary: string;
}

// --- Discovery Types (Schicht D) ---

export type IntentType = 'question' | 'comparison' | 'recommendation' | 'complaint' | 'discussion';

export type OpportunityStatus = 'new' | 'drafted' | 'posted' | 'skipped' | 'expired';

export type SelfPromoPolicy = 'strict' | 'moderate' | 'allowed';

export interface CommunityDiscoveryRequest {
  workspace_id: string;
  product_description: string;
  target_audience: string;
  competitors?: string[];
  platforms?: ('reddit' | 'facebook' | 'discord' | 'forum')[];
}

export interface DiscoveredCommunity {
  platform: string;
  name: string;
  url: string;
  member_count: number;
  activity_level: 'high' | 'medium' | 'low';
  relevance_score: number;
  language: string;
  rules_summary: string;
  self_promo_policy: SelfPromoPolicy;
  recommended_approach: string;
  top_recurring_questions: string[];
}

export interface Opportunity {
  id: string;
  platform: string;
  community: string;
  thread_title: string;
  thread_url: string;
  thread_author: string;
  posted_at: string;
  relevance_score: number;
  intent_type: IntentType;
  intent_score: number;
  suggested_angle: string;
  draft_reply?: string;
  status: OpportunityStatus;
  cooldown_warning?: string;
  response_map_match_id?: string;
  engagement_metrics?: { upvotes?: number; replies?: number };
}

export interface DraftRequest {
  opportunity_id: string;
  voice_config?: Partial<VoiceConfig>;
}

export interface DraftResponse {
  draft_id: string;
  content: string;
  reasoning: string;
  community_rules_check: {
    compliant: boolean;
    warnings: string[];
  };
  suggested_follow_up?: string;
}

export interface VoiceConfig {
  tone: 'casual' | 'professional' | 'technical' | 'empathetic';
  language: string;
  max_reply_length: number;
  include_personal_experience: boolean;
  avoid_patterns: string[];
  example_replies: string[];
}

export interface ResponseMapEntry {
  id: string;
  workspace_id: string;
  question_pattern: string;
  intent_type: string;
  best_answer: string;
  proof_asset_url?: string;
  link_policy: 'never' | 'if_asked' | 'in_followup';
  times_used: number;
  avg_engagement: number;
}

export interface AutoContextRequest {
  website_url: string;
  workspace_id: string;
}

export interface AutoContextResponse {
  product_description: string;
  target_audience: string;
  suggested_keywords: string[];
  suggested_voice: {
    tone: string;
    language: string;
    example_phrases: string[];
  };
  confidence: number;
}

export interface ReuseRequest {
  original_post_id?: string;
  original_content: string;
  target_community: string;
  angle_shift: string;
}

export interface ReuseResponse {
  adapted_title: string;
  adapted_content: string;
  differences_from_original: string;
  recommended_posting_time: string;
  cooldown_warning?: string;
}

export interface CooldownCheck {
  community_name: string;
  posts_this_week: number;
  last_posted_at: string | null;
  recommended_wait_days: number;
  warning: string | null;
}

// --- Webhook Types ---

export type WebhookEvent = 'post.published' | 'post.failed' | 'feedback.received' | 'feedback.alert';

export interface WebhookPayload {
  event: WebhookEvent;
  created_at: string;
  workspace_id: string;
  data: Record<string, unknown>;
}

// --- Auth Types ---

export interface Connection {
  connection_id: string;
  platform: PlatformType;
  account_name: string;
  account_type: AccountType;
  avatar_url?: string;
  connected_at: string;
  status: ConnectionStatus;
}

// --- Pricing Types ---

export type PlanType = 'starter' | 'pro' | 'agency';

export interface PlanLimits {
  max_connections: number;
  max_posts_per_month: number;
  max_feedback_sources: number;
  max_feedback_items_per_month: number;
  ai_credits: number;
  features: {
    daily_digest: boolean;
    alerts: boolean;
    bulk_import: boolean;
    discovery: boolean;
  };
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  starter: {
    max_connections: 3,
    max_posts_per_month: 15,
    max_feedback_sources: 1,
    max_feedback_items_per_month: 50,
    ai_credits: 0,
    features: { daily_digest: false, alerts: false, bulk_import: false, discovery: false },
  },
  pro: {
    max_connections: 10,
    max_posts_per_month: 150,
    max_feedback_sources: 5,
    max_feedback_items_per_month: 500,
    ai_credits: 100,
    features: { daily_digest: true, alerts: false, bulk_import: true, discovery: true },
  },
  agency: {
    max_connections: 25,
    max_posts_per_month: Infinity,
    max_feedback_sources: 15,
    max_feedback_items_per_month: Infinity,
    ai_credits: 500,
    features: { daily_digest: true, alerts: true, bulk_import: true, discovery: true },
  },
};

// --- Credit Costs ---

export const CREDIT_COSTS = {
  content_adaptation: 1,
  feedback_analysis: 0.5,
  ask_query: 2,
  executive_summary: 5,
  draft_reply: 1,
  community_discovery: 2,
  auto_context: 1,
  template_draft: 1,
  template_prefill: 1,
  pillar_splinter: 3,
} as const;

// --- Splinter Engine (GOAL-RUN6 §12 — Owned-Media-Flywheel) ---
// One pillar input (long-form text or dictated memo) is split into several
// STRUCTURALLY different channel-native drafts (Welsh 1-3-5), each labeled
// with the psychological framework that explains WHY it works (PIA / 4A) —
// transparency over black-box AI.

export type SplinterFramework4A = 'actionable' | 'analytical' | 'aspirational' | 'anthropological';

export interface SplinterSuggestion {
  /** Target platform this splinter is written for. */
  platform: PlatformType;
  /** Catalog template that shaped the structure (id), if one was used. */
  template_id?: string;
  /** Human-readable structure label, e.g. "Carousel", "Kurz-Hook", "Value-Post". */
  format_label: string;
  /** Which 4A angle this splinter takes. */
  framework_4a: SplinterFramework4A;
  /** One sentence: the Pain-Insight-Action mapping of this splinter. */
  pia_note: string;
  /** The core idea (of the 3 extracted) this splinter belongs to, 0-based. */
  core_idea_index: number;
  hook: string;
  content: string;
  first_comment?: string;
  /** Carousel slide texts, when the format calls for slides. */
  slides?: string[];
  /** Suggested publish day offset from tomorrow (0 = tomorrow). */
  suggested_day_offset: number;
}

export interface SplinterResult {
  core_ideas: string[];
  suggestions: SplinterSuggestion[];
  credits_used: number;
}

// --- Post Template Types (GOAL-RUN4) ---
// A template is a fixed, curated combination of the seven layers described in
// GOAL-RUN4-POST-TEMPLATES.md (intent, post type, psych level, script
// blueprint, style preset, CTA mechanic, platform adaptation).

export type TemplateIntent = 'value' | 'product' | 'community' | 'social_proof' | 'personal_brand';

export type TemplatePostType =
  | 'value_edu'
  | 'product_demo'
  | 'review'
  | 'unboxing'
  | 'tutorial'
  | 'transformation'
  | 'build_in_public'
  | 'lifestyle'
  | 'community_fomo'
  | 'crowdsourcing';

export type PsychLevel = 'rational' | 'emotional' | 'social';

export type CtaMechanic =
  | 'comment_trigger'
  | 'save_cta'
  | 'link_in_comment'
  | 'poll'
  | 'dm_invite'
  | 'none';

export type StylePreset = 'neutral' | 'hormozi_carousel' | 'ai_automation_screencast' | 'doku_modus';

export type TemplateFormat = 'text' | 'thread' | 'carousel_pdf' | 'image_text' | 'poll';

/**
 * What kind of answer a slot expects — governs what the AI may prefill
 * (GOAL-RUN5 T4/V4). 'fact' (real numbers/names) and 'erfahrung' (lived
 * experience) are NEVER prefilled with values: inventing them would fake
 * authenticity and is UWG-risky. Only 'angle' slots may receive AI values.
 */
export type TemplateSlotKind = 'fact' | 'erfahrung' | 'angle';

export interface TemplateSlot {
  key: string;
  /** Wizard question shown to the user (German — catalog data, not UI chrome). */
  question: string;
  /** Why we ask / what a good answer looks like (one line, German). */
  help: string;
  /** Concrete example answer, shown below the field — never inserted as value. */
  example: string;
  kind: TemplateSlotKind;
  placeholder?: string;
  required: boolean;
  /** Auto-filled from workspace_contexts when the user leaves the slot empty. */
  prefill_from?: 'product_description' | 'target_audience';
}

export interface TemplateBenchmark {
  metrik: string;
  /** Honest range, never a promise (e.g. "≈ 1,9× Reichweite vs. Text-Post"). */
  wert: string;
  /** Source label — must never be empty (Oracle O7). */
  quelle: string;
}

/** Strategy panel data (GOAL-RUN5 — user feedback #6: Ziel, Strategie, Erwartung). */
export interface TemplateStrategy {
  /** One sentence: what this post achieves strategically. */
  ziel: string;
  /** Exactly three bullets: why the mechanic works. */
  warum: [string, string, string];
  benchmarks: TemplateBenchmark[];
  aufwand: 'niedrig' | 'mittel' | 'hoch';
  frequenz: string;
  voraussetzungen?: string[];
}

export interface PostTemplate {
  id: string;
  name: string;
  description: string;
  intent: TemplateIntent;
  post_type: TemplatePostType;
  /** Primary level first — steers the drafting angle. */
  psych_levels: PsychLevel[];
  /** Ordered script slots, e.g. ['hook', 'kontext', 'demo', 'ergebnis', 'cta']. */
  structure: string[];
  /** Fill-in-the-blank hook formulas (German). */
  hook_formulas: string[];
  cta_mechanic: CtaMechanic;
  style_preset: StylePreset;
  format: TemplateFormat;
  recommended_platforms: PlatformType[];
  /**
   * Which "Was hast du zur Hand?"-Anlässe lead to this template (explicit
   * curation, GOAL-RUN5 T2 — keys from ANLASS_INFO in lib/templates/guide.ts).
   */
  anlass_keys: string[];
  strategy: TemplateStrategy;
  /** Max 4 user questions. */
  slots: TemplateSlot[];
  /** Extra prompt-builder instructions — stripped from API responses. */
  prompt_hints: string;
  /** Steps Prolora cannot publish automatically yet (e.g. PDF upload). */
  manual_steps?: string[];
}

export type PostTemplateSummary = Omit<PostTemplate, 'prompt_hints'>;

export interface TemplateDraftResult {
  content: string;
  first_comment?: string;
  /** Carousel slide texts; for screencast presets, slides[0] is the overlay line. */
  slides?: string[];
  manual_steps?: string[];
  recommended_platforms: PlatformType[];
}

export interface TemplateListResponse {
  templates: PostTemplateSummary[];
  /** Whether workspace_contexts has a row — powers slot-prefill hints. */
  context_available: boolean;
  /** Whether the workspace plan includes AI credits (scaffold mode always works). */
  ai_enabled: boolean;
}

export interface TemplateDraftResponse {
  template_id: string;
  draft: TemplateDraftResult;
  credits_used: number;
}

/** UI chrome locales (GOAL-RUN5 D7/T1 — catalog content stays German for now). */
export type AppLocale = 'de' | 'en' | 'es';

export interface SlotSuggestion {
  key: string;
  value: string;
  /**
   * true ⇒ show as example below the field, never as the field value.
   * Code-enforced for 'fact'/'erfahrung' slots (Oracle O4/O11).
   */
  is_example: boolean;
}

export interface TemplatePrefillResponse {
  template_id: string;
  suggestions: SlotSuggestion[];
  credits_used: number;
}
