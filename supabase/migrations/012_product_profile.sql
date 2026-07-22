-- GOAL-RUN9 Phase 0: product profile fields + proof assets.
-- ProofAssets are the anti-fabrication anchor: every product-performance claim
-- in a generated draft must trace back to one of these rows (or be framed as
-- an honest founder hypothesis). IF NOT EXISTS keeps re-runs safe.

ALTER TABLE workspace_contexts
  ADD COLUMN IF NOT EXISTS core_value TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS founder_perspective TEXT,
  ADD COLUMN IF NOT EXISTS brand_voice TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS taboo_topics TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS proof_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN ('metric', 'customer_quote', 'founder_observation', 'case_study', 'experiment')
  ),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 3 AND 2000),
  source_url TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proof_assets_ws
  ON proof_assets (workspace_id, created_at DESC);

ALTER TABLE proof_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proof_assets_workspace" ON proof_assets;
CREATE POLICY "proof_assets_workspace" ON proof_assets
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));
