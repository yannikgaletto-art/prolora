-- Global kill switch for every background job that costs money.
--
-- Why this table exists: the scheduled thread radar (*/15) fans out to an LLM
-- relevance pass per active community, so spend continued around the clock
-- while nobody was using the product. There was no way to stop it short of a
-- redeploy. Every Inngest function now reads this flag first and returns
-- early when it is false, so stopping and resuming is a UI action.
--
-- Scope: deliberately account-wide, not workspace-scoped. This is an
-- emergency stop, and a per-workspace switch would leave the operator
-- hunting for whichever workspace is still spending.
--
-- Access (Invariante 2 / same posture as workspace_integrations): service
-- role only, with RLS deny-by-default below. A leaked anon key must not be
-- able to read this row and — far worse — must not be able to switch
-- spending back on.

CREATE TABLE IF NOT EXISTS system_settings (
  id TEXT PRIMARY KEY,
  automation_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded OFF so applying this migration is itself the stop. Turning spending
-- back on is an explicit click in Settings -> System, never a side effect of
-- a deployment.
INSERT INTO system_settings (id, automation_enabled)
VALUES ('global', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Deny-by-default: no permissive policy is created on purpose. Dropping any
-- inherited policy makes that intent explicit and survives a re-run.
DROP POLICY IF EXISTS "system_settings_no_client_access" ON system_settings;
