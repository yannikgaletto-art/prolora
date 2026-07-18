-- GOAL-RUN8 Phase 4: Buffer-style recurring queue slots.
-- Idempotent because G3 may have been applied manually before this file lands.
CREATE TABLE IF NOT EXISTS posting_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES platform_connections(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  local_time TIME NOT NULL,
  timezone TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_posting_schedules_workspace_active
  ON posting_schedules (workspace_id, is_active);

ALTER TABLE posting_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posting_schedules_workspace" ON posting_schedules;
CREATE POLICY "posting_schedules_workspace"
  ON posting_schedules FOR ALL
  USING (workspace_id IN (SELECT public.user_workspace_ids()));
