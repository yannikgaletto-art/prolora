-- GOAL-RUN8 Phase 3: one workspace-level structural writing preference.
-- Idempotent because G2 may have been applied manually before this file lands.
ALTER TABLE workspace_contexts
  ADD COLUMN IF NOT EXISTS creator_style TEXT NOT NULL DEFAULT 'neutral';
