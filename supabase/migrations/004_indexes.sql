-- ============================================================
-- Prolora — Indexes
-- Performance-critical lookups from spec + FABLE docs
-- ============================================================

-- Workspaces
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);

-- Workspace Members
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

-- API Keys
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_workspace ON api_keys(workspace_id);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- Platform Connections
CREATE INDEX idx_connections_workspace ON platform_connections(workspace_id);
CREATE INDEX idx_connections_workspace_platform ON platform_connections(workspace_id, platform);
CREATE INDEX idx_connections_status ON platform_connections(status);
CREATE INDEX idx_connections_token_expires ON platform_connections(token_expires_at)
  WHERE status = 'active' AND token_expires_at IS NOT NULL;

-- Post Groups
CREATE INDEX idx_post_groups_workspace ON post_groups(workspace_id);
CREATE INDEX idx_post_groups_scheduled ON post_groups(scheduled_at)
  WHERE scheduled_at IS NOT NULL;

-- Post Items
CREATE INDEX idx_post_items_group ON post_items(post_group_id);
CREATE INDEX idx_post_items_connection ON post_items(connection_id);
CREATE INDEX idx_post_items_status ON post_items(status);
CREATE INDEX idx_post_items_platform_id ON post_items(platform_post_id)
  WHERE platform_post_id IS NOT NULL;

-- Feedback Sources
CREATE INDEX idx_feedback_sources_workspace ON feedback_sources(workspace_id);

-- Raw Feedback
CREATE INDEX idx_raw_feedback_workspace ON raw_feedback(workspace_id);
CREATE INDEX idx_raw_feedback_unprocessed ON raw_feedback(workspace_id)
  WHERE processed = false;

-- Feedback Items
CREATE INDEX idx_feedback_items_workspace ON feedback_items(workspace_id);
CREATE INDEX idx_feedback_items_status ON feedback_items(workspace_id, status);
CREATE INDEX idx_feedback_items_category ON feedback_items(workspace_id, category);
CREATE INDEX idx_feedback_items_sentiment ON feedback_items(workspace_id, sentiment);
CREATE INDEX idx_feedback_items_created ON feedback_items(workspace_id, created_at DESC);
CREATE INDEX idx_feedback_items_urgency ON feedback_items(workspace_id, urgency)
  WHERE urgency IN ('high', 'critical');

-- pgvector: IVFFlat index for embedding similarity search
CREATE INDEX idx_feedback_embeddings ON feedback_items
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Board Items
CREATE INDEX idx_board_items_workspace ON board_items(workspace_id);
CREATE INDEX idx_board_items_status ON board_items(workspace_id, status);
CREATE INDEX idx_board_items_votes ON board_items(workspace_id, vote_count DESC);

-- Board Votes
CREATE INDEX idx_board_votes_item ON board_votes(board_item_id);

-- Changelog
CREATE INDEX idx_changelog_workspace ON changelog_entries(workspace_id);
CREATE INDEX idx_changelog_published ON changelog_entries(workspace_id, published_at DESC)
  WHERE published_at IS NOT NULL;

-- Webhooks
CREATE INDEX idx_webhooks_workspace ON webhooks(workspace_id);
CREATE INDEX idx_webhooks_active ON webhooks(workspace_id)
  WHERE active = true;

-- Usage Logs
CREATE INDEX idx_usage_logs_workspace ON usage_logs(workspace_id);
CREATE INDEX idx_usage_logs_workspace_date ON usage_logs(workspace_id, created_at DESC);
CREATE INDEX idx_usage_logs_action ON usage_logs(workspace_id, action);

-- Discovery Communities
CREATE INDEX idx_communities_workspace ON discovery_communities(workspace_id);
CREATE INDEX idx_communities_platform ON discovery_communities(workspace_id, platform);
CREATE INDEX idx_communities_active ON discovery_communities(workspace_id)
  WHERE is_active = true;

-- Opportunity Threads
CREATE INDEX idx_opportunities_workspace ON opportunity_threads(workspace_id);
CREATE INDEX idx_opportunities_status ON opportunity_threads(workspace_id, status);
CREATE INDEX idx_opportunities_community ON opportunity_threads(community_id);
CREATE INDEX idx_opportunities_new ON opportunity_threads(workspace_id, created_at DESC)
  WHERE status = 'new';

-- Response Map
CREATE INDEX idx_response_map_workspace ON response_map(workspace_id);

-- Voice Configs
CREATE INDEX idx_voice_configs_workspace ON voice_configs(workspace_id);

-- Workspace Contexts
CREATE INDEX idx_workspace_contexts_workspace ON workspace_contexts(workspace_id);
