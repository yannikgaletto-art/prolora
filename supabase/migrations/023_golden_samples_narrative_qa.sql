-- Golden Samples, Facts Timeline and Narrative QA.
-- STOP-Gate: repository-only. Do not apply live without explicit user approval.

-- Prompt-safe sample metadata. Raw content remains available to the owner UI;
-- generation code uses masked_content.
ALTER TABLE content_samples
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS hook_type TEXT,
  ADD COLUMN IF NOT EXISTS content_format TEXT,
  ADD COLUMN IF NOT EXISTS masked_content TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_content_samples_retrieval
  ON content_samples (workspace_id, active, kind, platform, category, created_at DESC);

-- Proof Vault extension: confirmed, time-bounded facts are the only source for
-- verifiable generated claims. Ordinary proof assets remain compatible.
ALTER TABLE proof_assets
  ADD COLUMN IF NOT EXISTS fact_key TEXT,
  ADD COLUMN IF NOT EXISTS fact_kind TEXT CHECK (
    fact_kind IS NULL OR fact_kind IN (
      'current_state', 'historical_state', 'event', 'metric', 'financial', 'policy'
    )
  ),
  ADD COLUMN IF NOT EXISTS fact_value JSONB,
  ADD COLUMN IF NOT EXISTS fact_unit TEXT,
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fact_status TEXT CHECK (
    fact_status IS NULL OR fact_status IN ('confirmed', 'superseded', 'revoked')
  ),
  ADD COLUMN IF NOT EXISTS direction_policy TEXT CHECK (
    direction_policy IS NULL OR direction_policy IN ('free', 'warn_on_decrease', 'warn_on_increase')
  ),
  ADD COLUMN IF NOT EXISTS fact_change_reason TEXT,
  ADD COLUMN IF NOT EXISTS supersedes_proof_asset_id UUID
    REFERENCES proof_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE proof_assets
  DROP CONSTRAINT IF EXISTS proof_assets_fact_shape;
ALTER TABLE proof_assets
  ADD CONSTRAINT proof_assets_fact_shape CHECK (
    fact_key IS NULL OR (
      char_length(btrim(fact_key)) BETWEEN 3 AND 200
      AND fact_kind IS NOT NULL
      AND fact_value IS NOT NULL
      AND effective_from IS NOT NULL
      AND fact_status IS NOT NULL
      AND direction_policy IS NOT NULL
      AND verified_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_proof_assets_active_fact
  ON proof_assets (workspace_id, fact_key)
  WHERE fact_key IS NOT NULL AND fact_status = 'confirmed' AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_proof_assets_fact_timeline
  ON proof_assets (workspace_id, fact_key, effective_from DESC)
  WHERE fact_key IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_confirmed_fact_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.fact_key IS NOT NULL AND OLD.fact_status = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed facts must be superseded or revoked, not deleted'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_proof_assets_no_confirmed_fact_delete ON proof_assets;
CREATE TRIGGER trg_proof_assets_no_confirmed_fact_delete
  BEFORE DELETE ON proof_assets
  FOR EACH ROW EXECUTE FUNCTION prevent_confirmed_fact_delete();

ALTER TABLE proof_suggestions
  ADD COLUMN IF NOT EXISTS suggestion_origin TEXT NOT NULL DEFAULT 'feedback'
    CHECK (suggestion_origin IN ('feedback', 'draft', 'manual')),
  ADD COLUMN IF NOT EXISTS fact_payload JSONB,
  ADD COLUMN IF NOT EXISTS source_content_item_variant_id UUID
    REFERENCES content_item_variants(id) ON DELETE SET NULL;

-- Language siblings preserve the one-content-item/one-channel invariant.
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS language TEXT CHECK (language IS NULL OR language IN ('de', 'en')),
  ADD COLUMN IF NOT EXISTS generation_group_id UUID;

DROP INDEX IF EXISTS uq_content_items_signal_ref;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_items_signal_ref_language
  ON content_items (workspace_id, signal_ref, language)
  WHERE signal_ref IS NOT NULL AND language IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_items_legacy_signal_ref
  ON content_items (workspace_id, signal_ref)
  WHERE signal_ref IS NOT NULL AND language IS NULL;
CREATE INDEX IF NOT EXISTS idx_content_items_generation_group
  ON content_items (workspace_id, generation_group_id)
  WHERE generation_group_id IS NOT NULL;

ALTER TABLE workspace_writer_policies
  ADD COLUMN IF NOT EXISTS output_languages TEXT[] NOT NULL DEFAULT ARRAY['de']::TEXT[],
  ADD COLUMN IF NOT EXISTS product_mention_mode TEXT NOT NULL DEFAULT 'adaptive'
    CHECK (product_mention_mode IN ('adaptive', 'include', 'exclude'));

ALTER TABLE workspace_writer_policies
  DROP CONSTRAINT IF EXISTS workspace_writer_output_languages_valid;
ALTER TABLE workspace_writer_policies
  ADD CONSTRAINT workspace_writer_output_languages_valid CHECK (
    cardinality(output_languages) BETWEEN 1 AND 2
    AND output_languages <@ ARRAY['de', 'en']::TEXT[]
  );

ALTER TABLE post_items
  ADD COLUMN IF NOT EXISTS qa_context JSONB;

-- Superseding is serialized per workspace/fact key. A direction-policy break
-- is accepted only as an explicit confirmed fact with a written reason.
CREATE OR REPLACE FUNCTION upsert_confirmed_fact_atomic(
  p_workspace_id UUID,
  p_type TEXT,
  p_content TEXT,
  p_source_url TEXT,
  p_fact_key TEXT,
  p_fact_kind TEXT,
  p_fact_value JSONB,
  p_fact_unit TEXT,
  p_effective_from TIMESTAMPTZ,
  p_direction_policy TEXT,
  p_fact_change_reason TEXT,
  p_confirmed_by UUID
)
RETURNS SETOF public.proof_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous public.proof_assets%ROWTYPE;
  v_new public.proof_assets%ROWTYPE;
  v_old_number NUMERIC;
  v_new_number NUMERIC;
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_previous
  FROM public.proof_assets
  WHERE workspace_id = p_workspace_id
    AND fact_key = p_fact_key
    AND fact_status = 'confirmed'
    AND effective_to IS NULL
  FOR UPDATE;

  IF FOUND AND p_effective_from <= v_previous.effective_from THEN
    RAISE EXCEPTION 'new fact must start after the current fact' USING ERRCODE = '22023';
  END IF;

  IF FOUND AND v_previous.fact_value ? 'number' AND p_fact_value ? 'number' THEN
    v_old_number := (v_previous.fact_value ->> 'number')::NUMERIC;
    v_new_number := (p_fact_value ->> 'number')::NUMERIC;
    IF (
      (v_previous.direction_policy = 'warn_on_decrease' AND v_new_number < v_old_number)
      OR (v_previous.direction_policy = 'warn_on_increase' AND v_new_number > v_old_number)
    ) AND nullif(btrim(p_fact_change_reason), '') IS NULL THEN
      RAISE EXCEPTION 'direction policy change requires a reason' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF FOUND THEN
    UPDATE public.proof_assets
    SET fact_status = 'superseded', effective_to = p_effective_from
    WHERE id = v_previous.id AND workspace_id = p_workspace_id;
  END IF;

  INSERT INTO public.proof_assets (
    workspace_id, type, content, source_url, verified_at, origin,
    fact_key, fact_kind, fact_value, fact_unit, effective_from, effective_to,
    fact_status, direction_policy, fact_change_reason,
    supersedes_proof_asset_id, confirmed_by
  ) VALUES (
    p_workspace_id, p_type, p_content, p_source_url, now(), 'manual',
    btrim(p_fact_key), p_fact_kind, p_fact_value, p_fact_unit, p_effective_from, NULL,
    'confirmed', p_direction_policy, nullif(btrim(p_fact_change_reason), ''),
    v_previous.id, p_confirmed_by
  ) RETURNING * INTO v_new;

  RETURN NEXT v_new;
END;
$$;

REVOKE ALL ON FUNCTION upsert_confirmed_fact_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_confirmed_fact_atomic(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION confirm_fact_suggestion_atomic(
  p_workspace_id UUID,
  p_suggestion_id UUID,
  p_confirmed_by UUID
)
RETURNS SETOF public.proof_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.proof_suggestions%ROWTYPE;
  v_payload JSONB;
  v_fact public.proof_assets%ROWTYPE;
BEGIN
  SELECT * INTO v_suggestion
  FROM public.proof_suggestions
  WHERE id = p_suggestion_id AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'suggestion not found' USING ERRCODE = 'P0002'; END IF;
  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'suggestion already decided' USING ERRCODE = '40001';
  END IF;
  IF v_suggestion.fact_payload IS NULL THEN
    RAISE EXCEPTION 'suggestion has no fact payload' USING ERRCODE = '22023';
  END IF;
  v_payload := v_suggestion.fact_payload;

  SELECT * INTO v_fact FROM public.upsert_confirmed_fact_atomic(
    p_workspace_id,
    v_suggestion.suggested_type,
    v_suggestion.content,
    v_suggestion.source_url,
    v_payload ->> 'fact_key',
    v_payload ->> 'fact_kind',
    v_payload -> 'fact_value',
    v_payload ->> 'fact_unit',
    (v_payload ->> 'effective_from')::TIMESTAMPTZ,
    COALESCE(v_payload ->> 'direction_policy', 'free'),
    v_payload ->> 'fact_change_reason',
    p_confirmed_by
  );

  UPDATE public.proof_suggestions
  SET status = 'accepted', decided_at = now(), decided_by = p_confirmed_by,
      proof_asset_id = v_fact.id
  WHERE id = p_suggestion_id AND workspace_id = p_workspace_id;

  RETURN NEXT v_fact;
END;
$$;

REVOKE ALL ON FUNCTION confirm_fact_suggestion_atomic(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_fact_suggestion_atomic(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION import_content_sample_bundle_atomic(
  p_workspace_id UUID,
  p_samples JSONB
)
RETURNS SETOF public.content_samples
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sample JSONB;
  v_row public.content_samples%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workspace not found' USING ERRCODE = 'P0002'; END IF;
  IF jsonb_typeof(p_samples) <> 'array' OR jsonb_array_length(p_samples) > 50 THEN
    RAISE EXCEPTION 'invalid sample bundle' USING ERRCODE = '22023';
  END IF;

  FOR v_sample IN SELECT value FROM jsonb_array_elements(p_samples)
  LOOP
    INSERT INTO public.content_samples (
      workspace_id, kind, origin, platform, content, category, hook_type,
      content_format, masked_content, metadata, content_hash, active
    ) VALUES (
      p_workspace_id, 'golden', 'imported', v_sample ->> 'platform',
      v_sample ->> 'content', v_sample ->> 'category', v_sample ->> 'hookType',
      v_sample ->> 'contentFormat', v_sample ->> 'maskedContent',
      COALESCE(v_sample -> 'metadata', '{}'::jsonb), v_sample ->> 'contentHash', true
    )
    ON CONFLICT (workspace_id, kind, content_hash) DO UPDATE SET
      platform = EXCLUDED.platform,
      category = EXCLUDED.category,
      hook_type = EXCLUDED.hook_type,
      content_format = EXCLUDED.content_format,
      masked_content = EXCLUDED.masked_content,
      metadata = EXCLUDED.metadata,
      active = true
    RETURNING * INTO v_row;
    RETURN NEXT v_row;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION import_content_sample_bundle_atomic(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION import_content_sample_bundle_atomic(UUID, JSONB)
  TO service_role;

CREATE OR REPLACE FUNCTION update_writer_policy_narrative_atomic(
  p_workspace_id UUID,
  p_expected_version INTEGER,
  p_output_languages TEXT[],
  p_product_mention_mode TEXT,
  p_updated_by TEXT
)
RETURNS SETOF public.workspace_writer_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.workspace_writer_policies AS policy
  SET output_languages = p_output_languages,
      product_mention_mode = p_product_mention_mode,
      policy_version = policy.policy_version + 1,
      updated_by = p_updated_by
  WHERE policy.workspace_id = p_workspace_id
    AND policy.policy_version = p_expected_version
  RETURNING policy.*;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'writer policy changed concurrently' USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION update_writer_policy_narrative_atomic(UUID, INTEGER, TEXT[], TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_writer_policy_narrative_atomic(UUID, INTEGER, TEXT[], TEXT, TEXT)
  TO service_role;

-- Wrapper keeps post creation and QA attachment in the same database
-- transaction while retaining Migration 022's reviewed materialization logic.
CREATE OR REPLACE FUNCTION materialize_writer_bundle_with_qa(
  p_workspace_id UUID,
  p_review_id UUID,
  p_snapshot_hash TEXT,
  p_approver_id UUID,
  p_approver_role TEXT
)
RETURNS TABLE (post_group_id UUID, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_group_id UUID;
  v_created BOOLEAN;
  v_review public.writer_review_bundles%ROWTYPE;
BEGIN
  SELECT result.post_group_id, result.created
  INTO v_post_group_id, v_created
  FROM public.materialize_writer_bundle(
    p_workspace_id, p_review_id, p_snapshot_hash, p_approver_id, p_approver_role
  ) AS result;

  SELECT review.* INTO v_review
  FROM public.writer_review_bundles AS review
  WHERE review.id = p_review_id AND review.workspace_id = p_workspace_id;

  UPDATE public.post_items AS post_item
  SET qa_context = jsonb_build_object(
    'origin', 'writer',
    'language', v_review.snapshot -> 'generation' ->> 'language',
    'contentHash', encode(digest(COALESCE(post_item.resolved_content, ''), 'sha256'), 'hex'),
    'gateStatus', 'passed',
    'gateVersion', v_review.gate_version,
    'reviewId', v_review.id,
    'snapshotHash', v_review.snapshot_hash,
    'generation', COALESCE((
      SELECT context
      FROM jsonb_array_elements(v_review.snapshot -> 'generation' -> 'contexts') AS contexts(context)
      WHERE context ->> 'platform' = post_item.platform
      LIMIT 1
    ), '{}'::jsonb)
  )
  FROM public.content_item_variants AS variant
  WHERE post_item.content_item_variant_id = variant.id
    AND variant.workspace_id = p_workspace_id
    AND variant.content_item_id = v_review.content_item_id;

  RETURN QUERY SELECT v_post_group_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION materialize_writer_bundle_with_qa(UUID, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION materialize_writer_bundle_with_qa(UUID, UUID, TEXT, UUID, TEXT)
  TO service_role;
