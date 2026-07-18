-- GOAL-RUN8 Phase 2: prediction ↔ observed engagement calibration.
-- IF NOT EXISTS keeps this migration safe because G1 was applied manually in
-- Supabase before the repository migration was created.

CREATE TABLE IF NOT EXISTS impact_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_group_id UUID REFERENCES post_groups(id) ON DELETE SET NULL,
  post_item_id UUID REFERENCES post_items(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  virality_score SMALLINT NOT NULL CHECK (virality_score BETWEEN 0 AND 100),
  traffic_light TEXT NOT NULL CHECK (traffic_light IN ('green', 'yellow', 'red')),
  score_breakdown JSONB NOT NULL,
  improvements JSONB NOT NULL DEFAULT '[]',
  detected_framework TEXT,
  prompt_version SMALLINT NOT NULL,
  deterministic_version SMALLINT NOT NULL,
  model TEXT NOT NULL,
  outcome_engagement NUMERIC,
  outcome_ratio NUMERIC,
  outcome_z NUMERIC,
  outcome_bucket TEXT CHECK (outcome_bucket IN ('below', 'inline', 'above', 'outlier')),
  baseline_n SMALLINT,
  outcome_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impact_predictions_ws
  ON impact_predictions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impact_predictions_item
  ON impact_predictions (post_item_id) WHERE post_item_id IS NOT NULL;

ALTER TABLE impact_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "impact_predictions_workspace" ON impact_predictions;
CREATE POLICY "impact_predictions_workspace" ON impact_predictions
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));
