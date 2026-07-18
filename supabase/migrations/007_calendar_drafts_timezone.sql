-- GOAL-RUN6 Phase 2 (Kalender + Drafts + Zeitzone).
--
-- scheduled_at stays the UTC instant; scheduled_tz records the IANA zone the
-- user AUTHORED the time in, so the calendar renders a stable wall-clock slot
-- across viewer timezones and DST. workspaces.timezone is the default
-- authoring/display zone. 'draft' is a real post_items status: saved, never
-- swept by publish-scheduled (which selects status='scheduled' only), never
-- published without an explicit user action.

ALTER TABLE post_groups
  ADD COLUMN IF NOT EXISTS scheduled_tz TEXT;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Extend the status CHECK with 'draft' (constraint was auto-named by the
-- inline CHECK in 001).
ALTER TABLE post_items DROP CONSTRAINT IF EXISTS post_items_status_check;
ALTER TABLE post_items ADD CONSTRAINT post_items_status_check
  CHECK (status IN ('draft', 'queued', 'scheduled', 'publishing', 'published', 'failed', 'deleted'));

-- Month-range calendar reads: WHERE workspace_id = ? AND scheduled_at BETWEEN ? AND ?
CREATE INDEX IF NOT EXISTS idx_post_groups_ws_scheduled
  ON post_groups (workspace_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;
