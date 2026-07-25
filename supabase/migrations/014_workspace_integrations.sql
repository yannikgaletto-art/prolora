-- Workspace-owned third-party API credentials (first provider: Reddit).
--
-- Why this table exists: Reddit access used to be readable only from
-- REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET, so "Add Communities" dead-ended in a
-- message telling the user that "the operator" had to edit an env file — while
-- the user *was* the operator, sitting in a browser. Credentials live here so
-- they can be entered in the UI and take effect without a redeploy.
--
-- Secrets handling (Invariante 6 / FABLE-03 R4):
--   * `credentials` holds AES-256-GCM ciphertext in the versioned format from
--     lib/auth/encryption.ts ("v2:iv:authTag:payload"). Never plaintext.
--   * Access is service-role only, with explicit workspace_id scoping in
--     application code (Invariante 2). RLS below is deny-by-default: there is
--     deliberately NO permissive policy, so even a leaked anon key cannot read
--     ciphertext. The service-role client bypasses RLS as usual.
--   * `client_id_hint` is the *non-secret* half, stored in the clear purely so
--     the UI can show which Reddit app is connected without decrypting.

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('reddit')),
  credentials TEXT NOT NULL,
  client_id_hint TEXT,
  verified_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_workspace_integrations_ws
  ON workspace_integrations (workspace_id, provider);

ALTER TABLE workspace_integrations ENABLE ROW LEVEL SECURITY;

-- Deny-by-default: dropping any inherited/permissive policy makes the intent
-- explicit and survives a re-run of this migration.
DROP POLICY IF EXISTS "workspace_integrations_no_client_access" ON workspace_integrations;
