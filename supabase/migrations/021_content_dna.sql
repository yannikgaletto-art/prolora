-- Writer Autopilot pilot — Content DNA storage.
--
-- STOP-Gate: repository-only until the user explicitly applies it.
-- Profiles retain immutable analysis payloads; lifecycle status is the only
-- field that may change after insertion.

-- ---------------------------------------------------------------------------
-- Golden and Avoid Samples
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('golden', 'avoid')),
  origin TEXT NOT NULL CHECK (origin IN ('pasted', 'published', 'imported')),
  platform TEXT,
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 100000),
  source_post_item_id UUID REFERENCES post_items(id) ON DELETE SET NULL,
  source_url TEXT,
  label TEXT CHECK (label IS NULL OR char_length(label) <= 200),
  active BOOLEAN NOT NULL DEFAULT true,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_samples_workspace_kind_hash_unique
    UNIQUE (workspace_id, kind, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_content_samples_workspace
  ON content_samples (workspace_id, active, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_samples_source_post
  ON content_samples (workspace_id, source_post_item_id)
  WHERE source_post_item_id IS NOT NULL;

ALTER TABLE content_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_samples_workspace" ON content_samples;
CREATE POLICY "content_samples_workspace" ON content_samples
  FOR ALL
  USING (workspace_id IN (SELECT public.user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

DROP TRIGGER IF EXISTS trg_content_samples_touch ON content_samples;
CREATE TRIGGER trg_content_samples_touch
  BEFORE UPDATE ON content_samples
  FOR EACH ROW EXECUTE FUNCTION touch_content_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable, versioned DNA Profiles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_dna_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
  sample_set_hash TEXT NOT NULL CHECK (sample_set_hash ~ '^[a-f0-9]{64}$'),
  schema_version TEXT NOT NULL CHECK (char_length(btrim(schema_version)) BETWEEN 1 AND 100),
  profile JSONB NOT NULL,
  confidence JSONB NOT NULL,
  locked_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  model TEXT NOT NULL CHECK (char_length(btrim(model)) BETWEEN 1 AND 200),
  prompt_version TEXT NOT NULL CHECK (char_length(btrim(prompt_version)) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_dna_profiles_workspace_version_unique
    UNIQUE (workspace_id, version)
);

CREATE INDEX IF NOT EXISTS idx_content_dna_profiles_workspace
  ON content_dna_profiles (workspace_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_content_dna_profiles_sample_set
  ON content_dna_profiles (workspace_id, sample_set_hash);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_dna_active
  ON content_dna_profiles (workspace_id)
  WHERE status = 'active';

ALTER TABLE content_dna_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_dna_profiles_workspace" ON content_dna_profiles;
DROP POLICY IF EXISTS "content_dna_profiles_workspace_read" ON content_dna_profiles;
CREATE POLICY "content_dna_profiles_workspace_read" ON content_dna_profiles
  FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "content_dna_profiles_workspace_insert" ON content_dna_profiles;
CREATE POLICY "content_dna_profiles_workspace_insert" ON content_dna_profiles
  FOR INSERT
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "content_dna_profiles_workspace_update" ON content_dna_profiles;
CREATE POLICY "content_dna_profiles_workspace_update" ON content_dna_profiles
  FOR UPDATE
  USING (workspace_id IN (SELECT public.user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE OR REPLACE FUNCTION guard_content_dna_profile_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.sample_set_hash IS DISTINCT FROM OLD.sample_set_hash
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.profile IS DISTINCT FROM OLD.profile
    OR NEW.confidence IS DISTINCT FROM OLD.confidence
    OR NEW.locked_rules IS DISTINCT FROM OLD.locked_rules
    OR NEW.sample_count IS DISTINCT FROM OLD.sample_count
    OR NEW.model IS DISTINCT FROM OLD.model
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'content DNA profile payloads are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'building' AND NEW.status IN ('active', 'failed'))
    OR (OLD.status = 'active' AND NEW.status = 'superseded')
  ) THEN
    RAISE EXCEPTION 'invalid content DNA profile status transition: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_dna_profiles_immutable ON content_dna_profiles;
CREATE TRIGGER trg_content_dna_profiles_immutable
  BEFORE UPDATE ON content_dna_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_content_dna_profile_mutation();
