-- Generalises migration 014 from "Reddit credentials" to "workspace-owned
-- credentials for any provider", and makes discovery genuinely multi-platform.
--
-- Why now: 014 removed the "ask your operator to set REDDIT_CLIENT_ID" dead end
-- for exactly one provider. The same wall stands in front of every other one —
-- and in front of LinkedIn/X publishing, where the user cannot reach the env
-- file either. One CHECK constraint is what stands between that mechanism and
-- being reusable, so it is widened here rather than per provider later.
--
-- Provider values and who writes them:
--   reddit        — Discovery, workspace-registered Reddit app (from 014)
--   mastodon      — Discovery, public instance API; row optional (instance pins)
--   hackernews    — Discovery, Algolia API; keyless, row optional
--   bluesky       — Discovery, reuses the existing platform_connections entry
--   linkedin_app  — Publishing, the *user's own* LinkedIn OAuth app
--   x_app         — Publishing, the *user's own* X OAuth app
--
-- Secrets handling is unchanged from 014: `credentials` stays AES-256-GCM
-- ciphertext, `client_id_hint` is the non-secret half stored in the clear, and
-- RLS stays deny-by-default with service-role-only access plus explicit
-- workspace_id scoping in application code (Invariante 2 / FABLE-03 R4).

-- 1. Widen the provider allowlist. Constraints cannot be altered in place, so
--    the old one is dropped by its generated name and re-added.
ALTER TABLE workspace_integrations
  DROP CONSTRAINT IF EXISTS workspace_integrations_provider_check;

ALTER TABLE workspace_integrations
  ADD CONSTRAINT workspace_integrations_provider_check
  CHECK (provider IN (
    'reddit', 'mastodon', 'hackernews', 'bluesky', 'linkedin_app', 'x_app'
  ));

-- 2. Stable dedupe key for communities across providers.
--    `community_name` alone stops being unique once platform is more than
--    'reddit': r/saas and a #saas hashtag timeline would collide. The
--    provider-native id (subreddit name, hashtag, HN query) is what identity
--    should hang off. Nullable because rows written before 015 have none, and
--    backfilling from community_name is only correct for Reddit.
ALTER TABLE discovery_communities
  ADD COLUMN IF NOT EXISTS community_external_id TEXT;

-- Existing rows are all Reddit, where the external id *is* the community name.
UPDATE discovery_communities
  SET community_external_id = community_name
  WHERE community_external_id IS NULL AND platform = 'reddit';

-- Partial unique index rather than a constraint: rows still missing an external
-- id (non-Reddit rows predating this migration, if any) must not block writes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_communities_external
  ON discovery_communities (workspace_id, platform, community_external_id)
  WHERE community_external_id IS NOT NULL;
