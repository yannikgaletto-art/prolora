-- Writer Autopilot pilot — integrity foundation.
--
-- STOP-Gate: this migration is repository-only until explicitly applied by
-- the user. It extends Migration 017 without rewriting its history.

-- ---------------------------------------------------------------------------
-- Approval state + durable delivery link
-- ---------------------------------------------------------------------------

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_state_check;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_state_check CHECK (state IN (
    'signal', 'angled', 'concepted', 'drafted', 'gated', 'awaiting_approval',
    'scheduled', 'published', 'measured', 'rejected'
  ));

ALTER TABLE post_items
  ADD COLUMN IF NOT EXISTS content_item_variant_id UUID NULL
    REFERENCES content_item_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS publish_claim_attempt_id UUID NULL,
  ADD COLUMN IF NOT EXISTS publish_claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS publish_claim_lease_until TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_post_items_content_item_variant
  ON post_items (content_item_variant_id)
  WHERE content_item_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_post_items_publish_claim_lease
  ON post_items (publish_claim_lease_until)
  WHERE status = 'publishing';

-- ---------------------------------------------------------------------------
-- Atomic content-item transition
--
-- `__content_item_patch` is a private transport key used by the application
-- to keep the existing angle/concept/gate/mix/delivery patch in this same
-- transaction. It is stripped before the public transition metadata is saved.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION transition_content_item_atomic(
  p_workspace_id UUID,
  p_item_id UUID,
  p_expected_state TEXT,
  p_to_state TEXT,
  p_reason TEXT,
  p_actor TEXT,
  p_actor_id TEXT,
  p_metadata JSONB,
  p_scheduled_at TIMESTAMPTZ
)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  state TEXT,
  signal_ref TEXT,
  signal_kind TEXT,
  title TEXT,
  strength REAL,
  evidence JSONB,
  mix_bucket TEXT,
  angle JSONB,
  concept JSONB,
  gate_result JSONB,
  rejected_reason TEXT,
  stale_after TIMESTAMPTZ,
  state_entered_at TIMESTAMPTZ,
  stalled_at TIMESTAMPTZ,
  post_group_id UUID,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.content_items%ROWTYPE;
  v_patch JSONB := COALESCE(p_metadata -> '__content_item_patch', '{}'::JSONB);
  v_audit_metadata JSONB := COALESCE(p_metadata, '{}'::JSONB) - '__content_item_patch';
BEGIN
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'transition reason must contain 1 to 1000 characters'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor NOT IN ('system', 'user') THEN
    RAISE EXCEPTION 'transition actor must be system or user'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    ci.id,
    ci.workspace_id,
    ci.state,
    ci.signal_ref,
    ci.signal_kind,
    ci.title,
    ci.strength,
    ci.evidence,
    ci.mix_bucket,
    ci.angle,
    ci.concept,
    ci.gate_result,
    ci.rejected_reason,
    ci.stale_after,
    ci.state_entered_at,
    ci.stalled_at,
    ci.post_group_id,
    ci.scheduled_at,
    ci.created_at,
    ci.updated_at
  INTO v_item
  FROM public.content_items AS ci
  WHERE ci.id = p_item_id
    AND ci.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'content item not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_item.state <> p_expected_state THEN
    RAISE EXCEPTION 'content item state changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  IF NOT (
    (p_expected_state = 'signal' AND p_to_state IN ('angled', 'rejected'))
    OR (p_expected_state = 'angled' AND p_to_state IN ('concepted', 'rejected'))
    OR (p_expected_state = 'concepted' AND p_to_state IN ('drafted', 'rejected'))
    OR (p_expected_state = 'drafted' AND p_to_state IN ('gated', 'drafted', 'rejected'))
    OR (p_expected_state = 'gated' AND p_to_state IN (
      'awaiting_approval', 'scheduled', 'drafted', 'rejected'
    ))
    OR (p_expected_state = 'awaiting_approval' AND p_to_state IN (
      'drafted', 'scheduled', 'rejected'
    ))
    OR (p_expected_state = 'scheduled' AND p_to_state IN ('published', 'drafted', 'rejected'))
    OR (p_expected_state = 'published' AND p_to_state = 'measured')
  ) THEN
    RAISE EXCEPTION 'transition % -> % is not allowed', p_expected_state, p_to_state
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.content_items AS ci
  SET
    state = p_to_state,
    state_entered_at = now(),
    stalled_at = NULL,
    rejected_reason = CASE
      WHEN p_to_state = 'rejected' THEN btrim(p_reason)
      ELSE ci.rejected_reason
    END,
    angle = CASE
      WHEN v_patch ? 'angle' THEN NULLIF(v_patch -> 'angle', 'null'::JSONB)
      ELSE ci.angle
    END,
    concept = CASE
      WHEN v_patch ? 'concept' THEN NULLIF(v_patch -> 'concept', 'null'::JSONB)
      ELSE ci.concept
    END,
    gate_result = CASE
      WHEN v_patch ? 'gate_result' THEN NULLIF(v_patch -> 'gate_result', 'null'::JSONB)
      ELSE ci.gate_result
    END,
    mix_bucket = CASE
      WHEN v_patch ? 'mix_bucket' THEN v_patch ->> 'mix_bucket'
      ELSE ci.mix_bucket
    END,
    post_group_id = CASE
      WHEN v_patch ? 'post_group_id' THEN (v_patch ->> 'post_group_id')::UUID
      ELSE ci.post_group_id
    END,
    scheduled_at = CASE
      WHEN v_patch ? 'scheduled_at' THEN p_scheduled_at
      ELSE ci.scheduled_at
    END
  WHERE ci.id = p_item_id
    AND ci.workspace_id = p_workspace_id
    AND ci.state = p_expected_state
  RETURNING
    ci.id,
    ci.workspace_id,
    ci.state,
    ci.signal_ref,
    ci.signal_kind,
    ci.title,
    ci.strength,
    ci.evidence,
    ci.mix_bucket,
    ci.angle,
    ci.concept,
    ci.gate_result,
    ci.rejected_reason,
    ci.stale_after,
    ci.state_entered_at,
    ci.stalled_at,
    ci.post_group_id,
    ci.scheduled_at,
    ci.created_at,
    ci.updated_at
  INTO v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'content item state changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.content_item_transitions (
    content_item_id,
    workspace_id,
    from_state,
    to_state,
    reason,
    actor,
    actor_id,
    metadata
  )
  VALUES (
    p_item_id,
    p_workspace_id,
    p_expected_state,
    p_to_state,
    btrim(p_reason),
    p_actor,
    p_actor_id,
    v_audit_metadata
  );

  RETURN QUERY
  SELECT
    v_item.id,
    v_item.workspace_id,
    v_item.state,
    v_item.signal_ref,
    v_item.signal_kind,
    v_item.title,
    v_item.strength,
    v_item.evidence,
    v_item.mix_bucket,
    v_item.angle,
    v_item.concept,
    v_item.gate_result,
    v_item.rejected_reason,
    v_item.stale_after,
    v_item.state_entered_at,
    v_item.stalled_at,
    v_item.post_group_id,
    v_item.scheduled_at,
    v_item.created_at,
    v_item.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION transition_content_item_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION transition_content_item_atomic(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;

-- ---------------------------------------------------------------------------
-- Exactly-one external publishing claim
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION claim_post_item(
  p_workspace_id UUID,
  p_post_item_id UUID,
  p_attempt_id UUID,
  p_lease_until TIMESTAMPTZ
)
RETURNS TABLE (
  post_item_id UUID,
  claim_attempt_id UUID,
  claim_lease_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_group_id UUID;
  v_status TEXT;
  v_claim_attempt_id UUID;
  v_claim_lease_until TIMESTAMPTZ;
BEGIN
  IF p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'publish claim attempt id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_lease_until IS NULL OR p_lease_until <= now() THEN
    RAISE EXCEPTION 'publish claim lease must end in the future'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    pi.post_group_id,
    pi.status,
    pi.publish_claim_attempt_id,
    pi.publish_claim_lease_until
  INTO
    v_post_group_id,
    v_status,
    v_claim_attempt_id,
    v_claim_lease_until
  FROM public.post_items AS pi
  INNER JOIN public.post_groups AS pg
    ON pg.id = pi.post_group_id
  WHERE pi.id = p_post_item_id
    AND pg.workspace_id = p_workspace_id
  FOR UPDATE OF pi;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT (
    v_status IN ('queued', 'scheduled')
    OR (
      v_status = 'publishing'
      AND v_claim_attempt_id = p_attempt_id
    )
    OR (
      v_status = 'publishing'
      AND v_claim_lease_until IS NOT NULL
      AND v_claim_lease_until <= now()
    )
  ) THEN
    RETURN;
  END IF;

  UPDATE public.post_items AS pi
  SET
    status = 'publishing',
    publish_claim_attempt_id = p_attempt_id,
    publish_claimed_at = now(),
    publish_claim_lease_until = p_lease_until
  WHERE pi.id = p_post_item_id
    AND pi.post_group_id = v_post_group_id
  RETURNING pi.id, pi.publish_claim_attempt_id, pi.publish_claim_lease_until
  INTO post_item_id, claim_attempt_id, claim_lease_until;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION claim_post_item(UUID, UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_post_item(UUID, UUID, UUID, TIMESTAMPTZ)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Deferred to migration 022
-- ---------------------------------------------------------------------------
-- materialize_writer_bundle(p_workspace_id, p_review_id, p_snapshot_hash)
-- intentionally belongs in migration 022, after the writer review tables it
-- references exist. Migration 020 must not invent forward-reference stubs.
