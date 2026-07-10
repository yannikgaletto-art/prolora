-- ============================================================
-- Prolora — Row Level Security Policies
-- Invariant: kein Cross-Workspace-Datenleck
-- ============================================================

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastodon_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE changelog_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_configs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: workspace membership check
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM workspace_members
  WHERE user_id = auth.uid()
  UNION
  SELECT id FROM workspaces
  WHERE owner_id = auth.uid();
$$;

-- ============================================================
-- Workspaces
-- ============================================================

DROP POLICY IF EXISTS "workspace_select" ON workspaces;
CREATE POLICY "workspace_select" ON workspaces
  FOR SELECT USING (id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_insert" ON workspaces;
CREATE POLICY "workspace_insert" ON workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "workspace_update" ON workspaces;
CREATE POLICY "workspace_update" ON workspaces
  FOR UPDATE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "workspace_delete" ON workspaces;
CREATE POLICY "workspace_delete" ON workspaces
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================
-- Workspace Members
-- ============================================================

DROP POLICY IF EXISTS "members_select" ON workspace_members;
CREATE POLICY "members_select" ON workspace_members
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "members_manage" ON workspace_members;
CREATE POLICY "members_manage" ON workspace_members
  FOR ALL USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- API Keys
-- ============================================================

DROP POLICY IF EXISTS "api_keys_workspace" ON api_keys;
CREATE POLICY "api_keys_workspace" ON api_keys
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Platform Connections
-- ============================================================

DROP POLICY IF EXISTS "connections_workspace" ON platform_connections;
CREATE POLICY "connections_workspace" ON platform_connections
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Mastodon Instances (shared resource, read-only for all)
-- ============================================================

DROP POLICY IF EXISTS "mastodon_instances_read" ON mastodon_instances;
CREATE POLICY "mastodon_instances_read" ON mastodon_instances
  FOR SELECT USING (true);

-- ============================================================
-- Post Groups + Items
-- ============================================================

DROP POLICY IF EXISTS "post_groups_workspace" ON post_groups;
CREATE POLICY "post_groups_workspace" ON post_groups
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "post_items_workspace" ON post_items;
CREATE POLICY "post_items_workspace" ON post_items
  FOR ALL USING (
    post_group_id IN (
      SELECT id FROM post_groups
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- ============================================================
-- Feedback
-- ============================================================

DROP POLICY IF EXISTS "feedback_sources_workspace" ON feedback_sources;
CREATE POLICY "feedback_sources_workspace" ON feedback_sources
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "raw_feedback_workspace" ON raw_feedback;
CREATE POLICY "raw_feedback_workspace" ON raw_feedback
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "feedback_items_workspace" ON feedback_items;
CREATE POLICY "feedback_items_workspace" ON feedback_items
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Board: Public read (via view), private write
-- submitted_by_email, customer_mrr, internal_notes NIEMALS an Anon
-- ============================================================

DROP VIEW IF EXISTS public_board_items;
CREATE VIEW public_board_items AS
  SELECT
    id, workspace_id, title, description, submitted_by_name,
    vote_count, status, category, created_at, shipped_at
  FROM board_items;

DROP POLICY IF EXISTS "board_items_workspace" ON board_items;
CREATE POLICY "board_items_workspace" ON board_items
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "board_votes_insert" ON board_votes;
CREATE POLICY "board_votes_insert" ON board_votes
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "board_votes_select" ON board_votes;
CREATE POLICY "board_votes_select" ON board_votes
  FOR SELECT USING (true);

-- ============================================================
-- Changelog
-- ============================================================

DROP POLICY IF EXISTS "changelog_workspace_write" ON changelog_entries;
CREATE POLICY "changelog_workspace_write" ON changelog_entries
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Webhooks
-- ============================================================

DROP POLICY IF EXISTS "webhooks_workspace" ON webhooks;
CREATE POLICY "webhooks_workspace" ON webhooks
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Usage Logs
-- ============================================================

DROP POLICY IF EXISTS "usage_logs_workspace" ON usage_logs;
CREATE POLICY "usage_logs_workspace" ON usage_logs
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Discovery / Schicht D
-- ============================================================

DROP POLICY IF EXISTS "workspace_contexts_workspace" ON workspace_contexts;
CREATE POLICY "workspace_contexts_workspace" ON workspace_contexts
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "communities_workspace" ON discovery_communities;
CREATE POLICY "communities_workspace" ON discovery_communities
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "opportunities_workspace" ON opportunity_threads;
CREATE POLICY "opportunities_workspace" ON opportunity_threads
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "response_map_workspace" ON response_map;
CREATE POLICY "response_map_workspace" ON response_map
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "voice_configs_workspace" ON voice_configs;
CREATE POLICY "voice_configs_workspace" ON voice_configs
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));
