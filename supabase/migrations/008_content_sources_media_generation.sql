-- GOAL-RUN6 Phase 3 (Splinter-Engine) + AI Media Generation
-- (docs/superpowers/specs/2026-07-16-ai-media-generation-design.md).
--
-- content_sources: the pillar input of the splintering flywheel (Koe
-- newsletter-first / Welsh 1-3-5). Splinter suggestions are stored as JSONB on
-- the source; accepted suggestions become normal draft post_groups.
--
-- media_generations + media_budget_ledger: cost-controlled AI media with an
-- immutable ledger and an atomic reservation RPC (EUR 10/workspace/month hard
-- limit, enforced server-side — spec section "Budget and Billing Safety").

-- ============================================================
-- Splinter engine
-- ============================================================

CREATE TABLE content_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('paste', 'url', 'editor')),
  title TEXT,
  body_md TEXT NOT NULL,
  source_url TEXT,
  splinters JSONB NOT NULL DEFAULT '[]',
  splintered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'splintered', 'archived')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_content_sources_ws ON content_sources (workspace_id, created_at DESC);

-- Traceability: which pillar a draft came from (nullable — normal posts have none).
ALTER TABLE post_groups
  ADD COLUMN IF NOT EXISTS content_source_id UUID REFERENCES content_sources(id) ON DELETE SET NULL;

-- ============================================================
-- AI media generation
-- ============================================================

CREATE TABLE media_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  prompt TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('square', 'portrait', 'landscape')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  provider_job_id TEXT,
  storage_key TEXT,
  mime_type TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_media_generations_ws ON media_generations (workspace_id, created_at DESC);

CREATE TABLE media_budget_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL REFERENCES media_generations(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- calendar month key, e.g. '2026-07'
  estimated_eur NUMERIC(8, 4) NOT NULL,
  final_eur NUMERIC(8, 4),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'committed', 'released')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_media_budget_ws_month ON media_budget_ledger (workspace_id, month, state);

-- Atomic reservation: committed + reserved spend for the month must stay
-- within the limit. The advisory xact lock serializes concurrent requests per
-- workspace so parallel generations cannot jointly exceed the cap. Runs as a
-- single RPC transaction (PostgREST), so the lock spans check + insert.
CREATE OR REPLACE FUNCTION public.reserve_media_budget(
  p_workspace UUID,
  p_generation UUID,
  p_month TEXT,
  p_estimate NUMERIC,
  p_limit NUMERIC,
  p_provider TEXT,
  p_model TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_spend NUMERIC;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_workspace::text || ':media_budget'));
  SELECT COALESCE(SUM(COALESCE(final_eur, estimated_eur)), 0)
    INTO current_spend
    FROM media_budget_ledger
    WHERE workspace_id = p_workspace
      AND month = p_month
      AND state IN ('reserved', 'committed');
  IF current_spend + p_estimate > p_limit THEN
    RETURN FALSE;
  END IF;
  INSERT INTO media_budget_ledger
    (workspace_id, generation_id, month, estimated_eur, state, provider, model)
    VALUES (p_workspace, p_generation, p_month, p_estimate, 'reserved', p_provider, p_model);
  RETURN TRUE;
END;
$$;

-- ============================================================
-- RLS — service-role-only by default, member SELECT via the existing helper.
-- (Deliberately NO public policies — lesson from the mastodon_instances audit.)
-- ============================================================

ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_budget_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_sources_select" ON content_sources
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "media_generations_select" ON media_generations
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "media_budget_ledger_select" ON media_budget_ledger
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));
