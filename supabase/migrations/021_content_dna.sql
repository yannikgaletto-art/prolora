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
DROP POLICY IF EXISTS "content_samples_workspace_read" ON content_samples;
DROP POLICY IF EXISTS "content_samples_workspace_write" ON content_samples;
CREATE POLICY "content_samples_workspace_read" ON content_samples
  FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

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
  prompt_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
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
DROP POLICY IF EXISTS "content_dna_profiles_workspace_update" ON content_dna_profiles;

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
    OR NEW.prompt_rules IS DISTINCT FROM OLD.prompt_rules
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

-- ---------------------------------------------------------------------------
-- Atomic, workspace-locked service operations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_content_sample_atomic(
  p_workspace_id UUID,
  p_kind TEXT,
  p_origin TEXT,
  p_platform TEXT,
  p_content TEXT,
  p_source_post_item_id UUID,
  p_source_url TEXT,
  p_label TEXT,
  p_content_hash TEXT
)
RETURNS SETOF public.content_samples
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id
  ) THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('writer_content_dna'),
    hashtext(p_workspace_id::text)
  );

  IF p_source_post_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.post_items AS item
    INNER JOIN public.post_groups AS post_group
      ON post_group.id = item.post_group_id
    WHERE item.id = p_source_post_item_id
      AND post_group.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'invalid_source_post'
      USING ERRCODE = '22023';
  END IF;

  IF (
    SELECT count(*)
    FROM public.content_samples AS sample
    WHERE sample.workspace_id = p_workspace_id
      AND sample.active
  ) >= 50 THEN
    RAISE EXCEPTION 'content_sample_limit_reached'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  INSERT INTO public.content_samples (
    workspace_id,
    kind,
    origin,
    platform,
    content,
    source_post_item_id,
    source_url,
    label,
    active,
    content_hash
  )
  VALUES (
    p_workspace_id,
    p_kind,
    p_origin,
    p_platform,
    p_content,
    p_source_post_item_id,
    p_source_url,
    p_label,
    true,
    p_content_hash
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION update_content_sample_atomic(
  p_workspace_id UUID,
  p_sample_id UUID,
  p_set_active BOOLEAN,
  p_active BOOLEAN,
  p_set_label BOOLEAN,
  p_label TEXT
)
RETURNS SETOF public.content_samples
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_active BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id
  ) THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('writer_content_dna'),
    hashtext(p_workspace_id::text)
  );

  SELECT sample.active
  INTO v_current_active
  FROM public.content_samples AS sample
  WHERE sample.workspace_id = p_workspace_id
    AND sample.id = p_sample_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_set_active AND p_active IS NULL THEN
    RAISE EXCEPTION 'active cannot be null when set_active is true'
      USING ERRCODE = '22023';
  END IF;

  IF p_set_active AND p_active AND NOT v_current_active AND (
    SELECT count(*)
    FROM public.content_samples AS sample
    WHERE sample.workspace_id = p_workspace_id
      AND sample.active
  ) >= 50 THEN
    RAISE EXCEPTION 'content_sample_limit_reached'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  UPDATE public.content_samples AS sample
  SET
    active = CASE WHEN p_set_active THEN p_active ELSE sample.active END,
    label = CASE WHEN p_set_label THEN p_label ELSE sample.label END
  WHERE sample.workspace_id = p_workspace_id
    AND sample.id = p_sample_id
  RETURNING sample.*;
END;
$$;

CREATE OR REPLACE FUNCTION delete_content_sample_atomic(
  p_workspace_id UUID,
  p_sample_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id
  ) THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('writer_content_dna'),
    hashtext(p_workspace_id::text)
  );

  DELETE FROM public.content_samples AS sample
  WHERE sample.workspace_id = p_workspace_id
    AND sample.id = p_sample_id
  RETURNING sample.id INTO v_deleted_id;

  RETURN v_deleted_id;
END;
$$;

CREATE OR REPLACE FUNCTION rebuild_content_dna_atomic(
  p_workspace_id UUID,
  p_sample_set_members TEXT[],
  p_sample_set_hash TEXT,
  p_schema_version TEXT,
  p_profile JSONB,
  p_confidence JSONB,
  p_prompt_rules JSONB,
  p_locked_rules JSONB,
  p_sample_count INTEGER,
  p_model TEXT,
  p_prompt_version TEXT
)
RETURNS SETOF public.content_dna_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_sample_set_members TEXT[];
  v_current_locked_rules JSONB;
  v_next_version INTEGER;
  v_profile_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id
  ) THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('writer_content_dna'),
    hashtext(p_workspace_id::text)
  );

  SELECT COALESCE(
    array_agg(
      sample.kind || ':' || sample.content_hash
      ORDER BY sample.kind || ':' || sample.content_hash
    ),
    ARRAY[]::TEXT[]
  )
  INTO v_active_sample_set_members
  FROM public.content_samples AS sample
  WHERE sample.workspace_id = p_workspace_id
    AND sample.active;

  IF v_active_sample_set_members IS DISTINCT FROM p_sample_set_members THEN
    RAISE EXCEPTION 'content_sample_set_changed'
      USING ERRCODE = '40001';
  END IF;

  SELECT dna.locked_rules
  INTO v_current_locked_rules
  FROM public.content_dna_profiles AS dna
  WHERE dna.workspace_id = p_workspace_id
    AND dna.status = 'active'
  FOR UPDATE;

  IF FOUND AND v_current_locked_rules IS DISTINCT FROM p_locked_rules THEN
    RAISE EXCEPTION 'content_sample_set_changed'
      USING ERRCODE = '40001';
  END IF;

  SELECT COALESCE(MAX(dna.version), 0) + 1
  INTO v_next_version
  FROM public.content_dna_profiles AS dna
  WHERE dna.workspace_id = p_workspace_id;

  INSERT INTO public.content_dna_profiles (
    workspace_id,
    version,
    status,
    sample_set_hash,
    schema_version,
    profile,
    confidence,
    prompt_rules,
    locked_rules,
    sample_count,
    model,
    prompt_version
  )
  VALUES (
    p_workspace_id,
    v_next_version,
    'building',
    p_sample_set_hash,
    p_schema_version,
    p_profile,
    p_confidence,
    p_prompt_rules,
    p_locked_rules,
    p_sample_count,
    p_model,
    p_prompt_version
  )
  RETURNING id INTO v_profile_id;

  UPDATE public.content_dna_profiles AS dna
  SET status = 'superseded'
  WHERE dna.workspace_id = p_workspace_id
    AND dna.status = 'active';

  UPDATE public.content_dna_profiles AS dna
  SET status = 'active'
  WHERE dna.workspace_id = p_workspace_id
    AND dna.id = v_profile_id
    AND dna.status = 'building';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'content_dna_activation_failed'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT dna.*
  FROM public.content_dna_profiles AS dna
  WHERE dna.workspace_id = p_workspace_id
    AND dna.id = v_profile_id
    AND dna.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION create_content_sample_atomic(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_content_sample_atomic(UUID, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION update_content_sample_atomic(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_content_sample_atomic(UUID, UUID, BOOLEAN, BOOLEAN, BOOLEAN, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION delete_content_sample_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_content_sample_atomic(UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION rebuild_content_dna_atomic(
  UUID, TEXT[], TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, INTEGER, TEXT, TEXT
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rebuild_content_dna_atomic(
  UUID, TEXT[], TEXT, TEXT, JSONB, JSONB, JSONB, JSONB, INTEGER, TEXT, TEXT
)
  TO service_role;
