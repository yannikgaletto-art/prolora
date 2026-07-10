-- ============================================================
-- Prolora — Initial Schema
-- All core tables for Publishing (A), Feedback (C), Discovery (D)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Core: Workspaces + Auth
-- ============================================================

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  plan TEXT DEFAULT 'starter' CHECK (plan IN ('starter', 'pro', 'agency')),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- ============================================================
-- Schicht A: Publishing
-- ============================================================

CREATE TABLE platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_id TEXT,
  account_type TEXT DEFAULT 'personal',
  avatar_url TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  app_password_encrypted TEXT,
  bot_token_encrypted TEXT,
  scopes TEXT[],
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  config JSONB DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  last_health_check JSONB,
  rate_limit_state JSONB DEFAULT '{}',
  refresh_locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE mastodon_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_url TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE post_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  original_content TEXT NOT NULL,
  media JSONB DEFAULT '[]',
  scheduled_at TIMESTAMPTZ,
  adapt_content BOOLEAN DEFAULT false,
  first_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_via TEXT DEFAULT 'api' CHECK (created_via IN ('api', 'mcp', 'dashboard'))
);

CREATE TABLE post_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_group_id UUID REFERENCES post_groups(id) ON DELETE CASCADE NOT NULL,
  connection_id UUID REFERENCES platform_connections(id) NOT NULL,
  platform TEXT NOT NULL,
  adapted_content TEXT,
  status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'scheduled', 'publishing', 'published', 'failed', 'deleted')),
  platform_post_id TEXT,
  platform_url TEXT,
  published_at TIMESTAMPTZ,
  error_message TEXT,
  metrics JSONB DEFAULT '{}',
  metrics_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Schicht C: Feedback / Listening
-- ============================================================

CREATE TABLE feedback_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  source_type TEXT NOT NULL,
  config JSONB NOT NULL,
  status TEXT DEFAULT 'active',
  last_polled_at TIMESTAMPTZ,
  last_poll_cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE raw_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  source_id UUID REFERENCES feedback_sources(id),
  source_platform TEXT NOT NULL,
  source_url TEXT,
  source_external_id TEXT,
  author_name TEXT,
  author_avatar TEXT,
  content TEXT NOT NULL,
  rating NUMERIC(2,1),
  source_date TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  processed BOOLEAN DEFAULT false,
  UNIQUE(workspace_id, source_platform, source_external_id)
);

CREATE TABLE feedback_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  source_platform TEXT NOT NULL,
  source_url TEXT,
  source_author TEXT,
  source_author_avatar TEXT,
  source_date TIMESTAMPTZ,
  original_content TEXT NOT NULL,
  original_language TEXT,
  rating NUMERIC(2,1),
  sentiment TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral', 'mixed')),
  sentiment_score NUMERIC(3,2),
  category TEXT CHECK (category IN ('bug', 'feature_request', 'praise', 'complaint', 'question', 'other')),
  summary_de TEXT,
  summary_en TEXT,
  topics TEXT[],
  urgency TEXT CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
  actionable BOOLEAN DEFAULT false,
  suggested_action TEXT,
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of UUID REFERENCES feedback_items(id),
  embedding VECTOR(1536),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'archived')),
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Public Board + Changelog + Webhooks
-- ============================================================

CREATE TABLE board_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  submitted_by_email TEXT,
  submitted_by_name TEXT,
  customer_tier TEXT,
  customer_mrr NUMERIC(10,2),
  vote_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'planned', 'in_progress', 'shipped', 'declined')),
  category TEXT,
  linked_feedback_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT now(),
  shipped_at TIMESTAMPTZ
);

CREATE TABLE board_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_item_id UUID REFERENCES board_items(id) ON DELETE CASCADE NOT NULL,
  voter_email TEXT,
  voter_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(board_item_id, voter_fingerprint)
);

CREATE TABLE changelog_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  ai_drafted BOOLEAN DEFAULT false,
  related_board_items UUID[],
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL,
  secret_encrypted TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Usage / Billing
-- ============================================================

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  action TEXT NOT NULL,
  credits_used NUMERIC(6,2) DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Schicht D: Discovery / Distribution Intelligence
-- ============================================================

CREATE TABLE workspace_contexts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL UNIQUE,
  website_url TEXT,
  product_description TEXT,
  target_audience TEXT,
  suggested_keywords TEXT[] DEFAULT '{}',
  voice_tone TEXT DEFAULT 'casual',
  voice_language TEXT DEFAULT 'de',
  confidence NUMERIC(3,2),
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE discovery_communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  platform TEXT NOT NULL,
  community_name TEXT NOT NULL,
  community_url TEXT,
  member_count INTEGER,
  activity_level TEXT,
  relevance_score NUMERIC(3,2),
  language TEXT DEFAULT 'de',
  rules_summary TEXT,
  self_promo_policy TEXT,
  recommended_approach TEXT,
  top_questions JSONB DEFAULT '[]',
  keywords TEXT[] DEFAULT '{}',
  posting_cooldown_days INTEGER DEFAULT 5,
  posts_this_week INTEGER DEFAULT 0,
  week_reset_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  last_scanned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE opportunity_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  community_id UUID REFERENCES discovery_communities(id),
  platform TEXT NOT NULL,
  community_name TEXT NOT NULL,
  thread_title TEXT NOT NULL,
  thread_url TEXT NOT NULL,
  thread_external_id TEXT,
  thread_author TEXT,
  thread_body TEXT,
  posted_at TIMESTAMPTZ,
  relevance_score NUMERIC(3,2),
  intent_type TEXT,
  intent_score NUMERIC(3,2) DEFAULT 0,
  suggested_angle TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'drafted', 'posted', 'skipped', 'expired')),
  draft_content TEXT,
  posted_content TEXT,
  posted_at_confirmed TIMESTAMPTZ,
  cooldown_warning TEXT,
  response_map_match_id UUID,
  engagement_upvotes INTEGER,
  engagement_replies INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, platform, thread_external_id)
);

CREATE TABLE response_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  question_pattern TEXT NOT NULL,
  intent_type TEXT,
  best_answer TEXT NOT NULL,
  proof_asset_url TEXT,
  link_policy TEXT DEFAULT 'if_asked',
  times_used INTEGER DEFAULT 0,
  avg_engagement NUMERIC(6,1) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE voice_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  name TEXT DEFAULT 'default',
  tone TEXT DEFAULT 'casual',
  language TEXT DEFAULT 'de',
  max_reply_length INTEGER DEFAULT 500,
  include_personal_experience BOOLEAN DEFAULT true,
  avoid_patterns JSONB DEFAULT '["check out my tool", "I built X", "shameless plug"]',
  example_replies JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add FK now that response_map exists
ALTER TABLE opportunity_threads
  ADD CONSTRAINT fk_response_map_match
  FOREIGN KEY (response_map_match_id) REFERENCES response_map(id);
