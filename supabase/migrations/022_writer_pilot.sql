-- Writer Autopilot pilot — approval-required policy and immutable reviews.
--
-- STOP-Gate: repository-only until explicitly applied by the user.

CREATE TABLE IF NOT EXISTS workspace_writer_policies (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode TEXT NOT NULL DEFAULT 'approval_required'
    CHECK (mode = 'approval_required'),
  allowed_connection_ids UUID[] NOT NULL DEFAULT '{}',
  daily_post_cap INTEGER NOT NULL DEFAULT 1 CHECK (daily_post_cap BETWEEN 1 AND 20),
  weekly_credit_cap INTEGER NOT NULL DEFAULT 10 CHECK (weekly_credit_cap BETWEEN 1 AND 500),
  minimum_signal_strength REAL NOT NULL DEFAULT 0.6
    CHECK (minimum_signal_strength BETWEEN 0 AND 1),
  content_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiet_days INTEGER[] NOT NULL DEFAULT '{}',
  timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
  dna_profile_id UUID REFERENCES content_dna_profiles(id) ON DELETE SET NULL,
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_writer_quiet_days_valid CHECK (
    quiet_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::INTEGER[]
  )
);

CREATE INDEX IF NOT EXISTS idx_workspace_writer_policies_dna
  ON workspace_writer_policies (workspace_id, dna_profile_id);

ALTER TABLE workspace_writer_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace_writer_policies_read" ON workspace_writer_policies;
CREATE POLICY "workspace_writer_policies_read" ON workspace_writer_policies
  FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

DROP POLICY IF EXISTS "workspace_writer_policies_write" ON workspace_writer_policies;
DROP POLICY IF EXISTS "workspace_writer_policies_update" ON workspace_writer_policies;

DROP TRIGGER IF EXISTS trg_workspace_writer_policies_touch ON workspace_writer_policies;
CREATE TRIGGER trg_workspace_writer_policies_touch
  BEFORE UPDATE ON workspace_writer_policies
  FOR EACH ROW EXECUTE FUNCTION touch_content_updated_at();

CREATE OR REPLACE FUNCTION update_writer_policy_atomic(
  p_workspace_id UUID,
  p_expected_version INTEGER,
  p_enabled BOOLEAN,
  p_allowed_connection_ids UUID[],
  p_daily_post_cap INTEGER,
  p_weekly_credit_cap INTEGER,
  p_minimum_signal_strength REAL,
  p_content_mix JSONB,
  p_quiet_days INTEGER[],
  p_timezone TEXT,
  p_dna_profile_id UUID,
  p_updated_by TEXT
)
RETURNS SETOF public.workspace_writer_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.workspace_writer_policies%ROWTYPE;
BEGIN
  -- The workspace row is the initial-insert mutex; the policy row is the
  -- steady-state mutex. This makes version increments compare-and-swap safe.
  PERFORM 1
  FROM public.workspaces AS workspace
  WHERE workspace.id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Writer workspace not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT policy.*
  INTO v_current
  FROM public.workspace_writer_policies AS policy
  WHERE policy.workspace_id = p_workspace_id
  FOR UPDATE;

  IF (FOUND AND v_current.policy_version <> p_expected_version)
    OR (NOT FOUND AND p_expected_version <> 1)
  THEN
    RAISE EXCEPTION 'Writer policy version changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_allowed_connection_ids, '{}'::UUID[])) AS allowed(id)
    LEFT JOIN public.platform_connections AS connection
      ON connection.id = allowed.id
      AND connection.workspace_id = p_workspace_id
      AND connection.status = 'active'
    WHERE connection.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Writer policy contains an invalid destination'
      USING ERRCODE = '22023';
  END IF;

  IF p_dna_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.content_dna_profiles AS dna
    WHERE dna.id = p_dna_profile_id
      AND dna.workspace_id = p_workspace_id
      AND dna.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Writer policy contains an inactive DNA profile'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.workspace_writer_policies (
    workspace_id,
    enabled,
    mode,
    allowed_connection_ids,
    daily_post_cap,
    weekly_credit_cap,
    minimum_signal_strength,
    content_mix,
    quiet_days,
    timezone,
    dna_profile_id,
    policy_version,
    updated_by
  )
  VALUES (
    p_workspace_id,
    p_enabled,
    'approval_required',
    COALESCE(p_allowed_connection_ids, '{}'::UUID[]),
    p_daily_post_cap,
    p_weekly_credit_cap,
    p_minimum_signal_strength,
    COALESCE(p_content_mix, '{}'::JSONB),
    COALESCE(p_quiet_days, '{}'::INTEGER[]),
    p_timezone,
    p_dna_profile_id,
    p_expected_version + 1,
    p_updated_by
  )
  ON CONFLICT (workspace_id) DO UPDATE
  SET
    enabled = EXCLUDED.enabled,
    mode = EXCLUDED.mode,
    allowed_connection_ids = EXCLUDED.allowed_connection_ids,
    daily_post_cap = EXCLUDED.daily_post_cap,
    weekly_credit_cap = EXCLUDED.weekly_credit_cap,
    minimum_signal_strength = EXCLUDED.minimum_signal_strength,
    content_mix = EXCLUDED.content_mix,
    quiet_days = EXCLUDED.quiet_days,
    timezone = EXCLUDED.timezone,
    dna_profile_id = EXCLUDED.dna_profile_id,
    policy_version = p_expected_version + 1,
    updated_by = EXCLUDED.updated_by
  WHERE workspace_writer_policies.policy_version = p_expected_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Writer policy version changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  SELECT policy.*
  FROM public.workspace_writer_policies AS policy
  WHERE policy.workspace_id = p_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION update_writer_policy_atomic(
  UUID, INTEGER, BOOLEAN, UUID[], INTEGER, INTEGER, REAL, JSONB, INTEGER[],
  TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_writer_policy_atomic(
  UUID, INTEGER, BOOLEAN, UUID[], INTEGER, INTEGER, REAL, JSONB, INTEGER[],
  TEXT, UUID, TEXT
) TO service_role;

-- Snapshot variants carry the exact channel payload that was gated. These
-- defaulted columns keep existing producers source-compatible.
ALTER TABLE content_item_variants
  ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS first_comment TEXT;

-- Additive delivery fields preserve thread/article semantics even while the
-- current publisher continues to use resolved_content.
ALTER TABLE post_items
  ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'post'
    CHECK (content_format IN ('post', 'thread', 'article')),
  ADD COLUMN IF NOT EXISTS content_segments JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS writer_review_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'invalidated', 'rejected', 'expired')),
  snapshot JSONB NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  variant_hashes JSONB NOT NULL,
  source_set_hash TEXT NOT NULL CHECK (source_set_hash ~ '^[a-f0-9]{64}$'),
  dna_profile_id UUID NOT NULL REFERENCES content_dna_profiles(id),
  dna_version INTEGER NOT NULL CHECK (dna_version > 0),
  prompt_version TEXT NOT NULL,
  gate_version TEXT NOT NULL,
  policy_version INTEGER NOT NULL CHECK (policy_version > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_by UUID REFERENCES auth.users(id),
  approved_role TEXT CHECK (approved_role IN ('owner', 'admin')),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  superseded_by UUID REFERENCES writer_review_bundles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT writer_review_approval_fields CHECK (
    status <> 'approved'
    OR (
      approved_by IS NOT NULL
      AND approved_role IS NOT NULL
      AND approved_at IS NOT NULL
    )
  ),
  CONSTRAINT writer_review_rejection_fields CHECK (
    status <> 'rejected'
    OR (
      rejected_by IS NOT NULL
      AND rejected_at IS NOT NULL
      AND rejection_reason IS NOT NULL
      AND char_length(btrim(rejection_reason)) BETWEEN 1 AND 1000
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_writer_review_pending
  ON writer_review_bundles (content_item_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_writer_review_workspace_status
  ON writer_review_bundles (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_writer_review_expiry
  ON writer_review_bundles (workspace_id, expires_at)
  WHERE status = 'pending';

ALTER TABLE writer_review_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "writer_review_bundles_read" ON writer_review_bundles;
CREATE POLICY "writer_review_bundles_read" ON writer_review_bundles
  FOR SELECT
  USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- Review writes are service-only. Browser clients may read workspace reviews,
-- but cannot forge snapshots, approvers, or terminal states through RLS.
DROP POLICY IF EXISTS "writer_review_bundles_insert" ON writer_review_bundles;
DROP POLICY IF EXISTS "writer_review_bundles_update" ON writer_review_bundles;

CREATE OR REPLACE FUNCTION guard_writer_review_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.content_item_id IS DISTINCT FROM OLD.content_item_id
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
    OR NEW.variant_hashes IS DISTINCT FROM OLD.variant_hashes
    OR NEW.source_set_hash IS DISTINCT FROM OLD.source_set_hash
    OR NEW.dna_profile_id IS DISTINCT FROM OLD.dna_profile_id
    OR NEW.dna_version IS DISTINCT FROM OLD.dna_version
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.gate_version IS DISTINCT FROM OLD.gate_version
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Writer review snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF (
    NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_role IS DISTINCT FROM OLD.approved_role
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) AND NOT (
    OLD.status = 'pending'
    AND NEW.status = 'approved'
    AND OLD.approved_by IS NULL
    AND OLD.approved_role IS NULL
    AND OLD.approved_at IS NULL
    AND NEW.approved_by IS NOT NULL
    AND NEW.approved_role IN ('owner', 'admin')
    AND NEW.approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Writer review approval provenance is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    NEW.status = OLD.status
    OR (
      OLD.status = 'pending'
      AND NEW.status IN ('approved', 'invalidated', 'rejected', 'expired')
    )
  ) THEN
    RAISE EXCEPTION 'invalid Writer review transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_writer_review_snapshot_immutable ON writer_review_bundles;
CREATE TRIGGER trg_writer_review_snapshot_immutable
  BEFORE UPDATE ON writer_review_bundles
  FOR EACH ROW EXECUTE FUNCTION guard_writer_review_snapshot_mutation();

-- Atomic approval-to-delivery boundary. Approver provenance, freshness,
-- policy limits, and delivery rows are committed together or not at all.
CREATE OR REPLACE FUNCTION materialize_writer_bundle(
  p_workspace_id UUID,
  p_review_id UUID,
  p_snapshot_hash TEXT,
  p_approver_id UUID,
  p_approver_role TEXT
)
RETURNS TABLE (
  post_group_id UUID,
  created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_review public.writer_review_bundles%ROWTYPE;
  v_item public.content_items%ROWTYPE;
  v_policy public.workspace_writer_policies%ROWTYPE;
  v_variant JSONB;
  v_post_group_id UUID;
  v_primary_post_group_id UUID;
  v_scheduled_at TIMESTAMPTZ;
  v_scheduled_tz TEXT;
  v_item_media JSONB;
  v_daily_count INTEGER;
BEGIN
  SELECT wr.*
  INTO v_review
  FROM public.writer_review_bundles AS wr
  WHERE wr.id = p_review_id
    AND wr.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Writer review not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT ci.*
  INTO v_item
  FROM public.content_items AS ci
  WHERE ci.id = v_review.content_item_id
    AND ci.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Writer content item not found in workspace'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_review.snapshot_hash <> p_snapshot_hash THEN
    RAISE EXCEPTION 'Writer review snapshot hash is stale'
      USING ERRCODE = '22023';
  END IF;

  IF p_approver_role NOT IN ('owner', 'admin') OR NOT (
    (
      p_approver_role = 'owner'
      AND EXISTS (
        SELECT 1
        FROM public.workspaces AS workspace
        WHERE workspace.id = p_workspace_id
          AND workspace.owner_id = p_approver_id
      )
    )
    OR (
      p_approver_role = 'admin'
      AND EXISTS (
        SELECT 1
        FROM public.workspace_members AS membership
        WHERE membership.workspace_id = p_workspace_id
          AND membership.user_id = p_approver_id
          AND membership.role = 'admin'
      )
    )
  ) THEN
    RAISE EXCEPTION 'Writer approver role is no longer valid'
      USING ERRCODE = '42501';
  END IF;

  IF v_review.status = 'approved' AND v_item.post_group_id IS NOT NULL THEN
    post_group_id := v_item.post_group_id;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_review.status <> 'pending'
    OR v_review.expires_at <= now()
    OR v_item.state <> 'awaiting_approval'
  THEN
    RAISE EXCEPTION 'Writer review is not approvable'
      USING ERRCODE = '22023';
  END IF;

  SELECT policy.*
  INTO v_policy
  FROM public.workspace_writer_policies AS policy
  WHERE policy.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_policy.enabled IS NOT TRUE
    OR v_policy.mode <> 'approval_required'
    OR v_policy.policy_version <> v_review.policy_version
  THEN
    RAISE EXCEPTION 'Writer policy changed after review creation'
      USING ERRCODE = '22023';
  END IF;

  v_scheduled_at :=
    (v_review.snapshot -> 'proposedSlot' ->> 'scheduledAt')::TIMESTAMPTZ;
  v_scheduled_tz := v_review.snapshot -> 'proposedSlot' ->> 'timezone';

  IF v_scheduled_tz IS DISTINCT FROM v_policy.timezone THEN
    RAISE EXCEPTION 'Writer schedule timezone changed after review creation'
      USING ERRCODE = '22023';
  END IF;

  IF EXTRACT(
    DOW FROM (v_scheduled_at AT TIME ZONE v_policy.timezone)
  )::INTEGER = ANY(v_policy.quiet_days) THEN
    RAISE EXCEPTION 'Writer proposed slot is on a quiet day'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO v_daily_count
  FROM public.content_items AS scheduled_item
  WHERE scheduled_item.workspace_id = p_workspace_id
    AND scheduled_item.id <> v_item.id
    AND scheduled_item.state IN ('scheduled', 'published', 'measured')
    AND scheduled_item.scheduled_at IS NOT NULL
    AND (
      scheduled_item.scheduled_at AT TIME ZONE v_policy.timezone
    )::DATE = (
      v_scheduled_at AT TIME ZONE v_policy.timezone
    )::DATE;

  IF v_daily_count >= v_policy.daily_post_cap THEN
    RAISE EXCEPTION 'Writer daily post cap is already reached'
      USING ERRCODE = '22023';
  END IF;

  IF v_item.title <> v_review.snapshot -> 'contentItem' ->> 'title' THEN
    RAISE EXCEPTION 'Writer content item changed after review creation'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(v_review.snapshot -> 'variants') = 0 THEN
    RAISE EXCEPTION 'Writer review has no selected variants'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.content_dna_profiles AS dna
    WHERE dna.id = v_review.dna_profile_id
      AND dna.id = v_policy.dna_profile_id
      AND dna.workspace_id = p_workspace_id
      AND dna.status = 'active'
      AND dna.version = v_review.dna_version
      AND dna.version = (v_review.snapshot -> 'dna' ->> 'version')::INTEGER
      AND dna.prompt_version = v_review.prompt_version
      AND dna.prompt_version = v_review.snapshot -> 'versions' ->> 'prompt'
      AND encode(
        digest(
          concat_ws(
            ':',
            dna.id::TEXT,
            dna.version::TEXT,
            dna.prompt_version,
            dna.sample_set_hash
          ),
          'sha256'
        ),
        'hex'
      ) = v_review.snapshot -> 'versions' ->> 'promptHash'
  ) THEN
    RAISE EXCEPTION 'Writer DNA or prompt changed after review creation'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      v_review.snapshot -> 'sources' -> 'proofAssets'
    ) AS sources(source)
    LEFT JOIN public.proof_assets AS proof
      ON proof.id = (source ->> 'id')::UUID
      AND proof.workspace_id = p_workspace_id
    WHERE proof.id IS NULL
      OR proof.consent_status NOT IN ('not_required', 'granted')
      OR proof.consent_status <> source ->> 'consentStatus'
      OR proof.verified_at IS DISTINCT FROM
        NULLIF(source ->> 'verifiedAt', '')::TIMESTAMPTZ
      OR encode(digest(proof.content, 'sha256'), 'hex')
        <> source ->> 'contentHash'
  ) THEN
    RAISE EXCEPTION 'Writer review proof changed'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      v_review.snapshot -> 'sources' -> 'feedbackItems'
    ) AS sources(source)
    LEFT JOIN public.feedback_items AS feedback
      ON feedback.id = (source ->> 'id')::UUID
      AND feedback.workspace_id = p_workspace_id
    WHERE feedback.id IS NULL
      OR encode(digest(feedback.original_content, 'sha256'), 'hex')
        <> source ->> 'contentHash'
  ) THEN
    RAISE EXCEPTION 'Writer feedback provenance changed'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      v_review.snapshot -> 'sources' -> 'references'
    ) AS sources(source)
    LEFT JOIN public.content_references AS reference
      ON reference.id = (source ->> 'id')::UUID
      AND (
        reference.workspace_id IS NULL
        OR reference.workspace_id = p_workspace_id
      )
    WHERE reference.id IS NULL
      OR reference.verified_at IS DISTINCT FROM
        NULLIF(source ->> 'verifiedAt', '')::TIMESTAMPTZ
      OR encode(digest(reference.reusable_pattern, 'sha256'), 'hex')
        <> source ->> 'contentHash'
  ) THEN
    RAISE EXCEPTION 'Writer reference provenance changed'
      USING ERRCODE = '22023';
  END IF;

  FOR v_variant IN
    SELECT value FROM jsonb_array_elements(v_review.snapshot -> 'variants')
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.content_item_variants AS variant
      INNER JOIN public.platform_connections AS connection
        ON connection.id = variant.connection_id
      WHERE variant.id = (v_variant ->> 'id')::UUID
        AND variant.content_item_id = v_item.id
        AND variant.workspace_id = p_workspace_id
        AND variant.gate_passed IS TRUE
        AND variant.connection_id = (v_variant -> 'connection' ->> 'id')::UUID
        AND variant.channel_key = v_variant ->> 'channelKey'
        AND variant.platform = v_variant ->> 'platform'
        AND variant.format = v_variant ->> 'format'
        AND variant.content = v_variant ->> 'content'
        AND variant.segments = COALESCE(v_variant -> 'segments', '[]'::JSONB)
        AND variant.media IS NOT DISTINCT FROM
          COALESCE(v_variant -> 'media', '[]'::JSONB)
        AND variant.first_comment IS NOT DISTINCT FROM
          (v_variant ->> 'firstComment')
        AND variant.gate_result IS NOT DISTINCT FROM v_variant -> 'gateResult'
        AND (
          SELECT COALESCE(array_agg(proof_id ORDER BY proof_id), '{}'::UUID[])
          FROM unnest(variant.proof_asset_ids) AS proof_ids(proof_id)
        ) = (
          SELECT COALESCE(
            array_agg((proof_id #>> '{}')::UUID ORDER BY (proof_id #>> '{}')::UUID),
            '{}'::UUID[]
          )
          FROM jsonb_array_elements(
            v_variant -> 'proofAssetIds'
          ) AS proof_ids(proof_id)
        )
        AND connection.workspace_id = p_workspace_id
        AND connection.status = 'active'
        AND connection.platform = v_variant -> 'connection' ->> 'platform'
        AND connection.account_name = v_variant -> 'connection' ->> 'accountName'
        AND connection.account_id IS NOT DISTINCT FROM
          NULLIF(v_variant -> 'connection' ->> 'accountId', '')
        AND connection.id = ANY(v_policy.allowed_connection_ids)
    ) THEN
      RAISE EXCEPTION 'Writer review destination or gate changed'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.post_items AS existing_item
    INNER JOIN public.post_groups AS existing_group
      ON existing_group.id = existing_item.post_group_id
    WHERE existing_group.workspace_id = p_workspace_id
      AND existing_group.scheduled_at = v_scheduled_at
      AND existing_item.status NOT IN ('failed', 'deleted')
      AND existing_item.connection_id IN (
        SELECT (variant -> 'connection' ->> 'id')::UUID
        FROM jsonb_array_elements(v_review.snapshot -> 'variants') AS variants(variant)
      )
  ) THEN
    RAISE EXCEPTION 'Writer destination slot is already occupied'
      USING ERRCODE = '22023';
  END IF;

  FOR v_variant IN
    SELECT value FROM jsonb_array_elements(v_review.snapshot -> 'variants')
  LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'type',
          CASE
            WHEN media ->> 'mimeType' LIKE 'video/%' THEN 'video'
            WHEN media ->> 'mimeType' = 'application/pdf' THEN 'document'
            ELSE 'image'
          END,
          'storage_key', media ->> 'storageKey',
        'mime_type', media ->> 'mimeType',
          'alt_text', media ->> 'altText',
          'content_hash', media ->> 'contentHash'
        )
        ORDER BY media ->> 'storageKey'
      ),
      '[]'::JSONB
    )
    INTO v_item_media
    FROM jsonb_array_elements(
      COALESCE(v_variant -> 'media', '[]'::JSONB)
    ) AS media_items(media);

    -- The existing publisher reads first_comment from post_groups. One group
    -- per destination therefore preserves channel-specific comments exactly.
    v_post_group_id := gen_random_uuid();
    IF v_primary_post_group_id IS NULL THEN
      v_primary_post_group_id := v_post_group_id;
    END IF;

    INSERT INTO public.post_groups (
      id,
      workspace_id,
      original_content,
      media,
      scheduled_at,
      scheduled_tz,
      adapt_content,
      first_comment,
      created_via
    )
    VALUES (
      v_post_group_id,
      p_workspace_id,
      v_variant ->> 'content',
      v_item_media,
      v_scheduled_at,
      v_scheduled_tz,
      false,
      v_variant ->> 'firstComment',
      'dashboard'
    );

    INSERT INTO public.post_items (
      post_group_id,
      connection_id,
      platform,
      adapted_content,
      resolved_content,
      media,
      content_format,
      content_segments,
      status,
      content_item_variant_id
    )
    VALUES (
      v_post_group_id,
      (v_variant -> 'connection' ->> 'id')::UUID,
      v_variant ->> 'platform',
      v_variant ->> 'content',
      v_variant ->> 'content',
      v_item_media,
      v_variant ->> 'format',
      COALESCE(v_variant -> 'segments', '[]'::JSONB),
      'scheduled',
      (v_variant ->> 'id')::UUID
    );
  END LOOP;

  UPDATE public.content_items AS ci
  SET
    state = 'scheduled',
    state_entered_at = now(),
    post_group_id = v_primary_post_group_id,
    scheduled_at = v_scheduled_at,
    updated_at = now()
  WHERE ci.id = v_item.id
    AND ci.workspace_id = p_workspace_id
    AND ci.state = 'awaiting_approval';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Writer content item state changed concurrently'
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
    v_item.id,
    p_workspace_id,
    'awaiting_approval',
    'scheduled',
    'Writer review explicitly approved',
    'user',
    p_approver_id::TEXT,
    jsonb_build_object(
      'review_id', v_review.id,
      'snapshot_hash', v_review.snapshot_hash,
      'approver_role', p_approver_role
    )
  );

  UPDATE public.writer_review_bundles AS wr
  SET
    status = 'approved',
    approved_by = p_approver_id,
    approved_role = p_approver_role,
    approved_at = now()
  WHERE wr.id = v_review.id
    AND wr.workspace_id = p_workspace_id
    AND wr.status = 'pending';

  post_group_id := v_primary_post_group_id;
  created := true;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION materialize_writer_bundle(UUID, UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION materialize_writer_bundle(UUID, UUID, TEXT, UUID, TEXT)
  TO service_role;
