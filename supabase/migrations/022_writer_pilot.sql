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
CREATE POLICY "workspace_writer_policies_write" ON workspace_writer_policies
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces AS workspace
      WHERE workspace.id = workspace_writer_policies.workspace_id
        AND workspace.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members AS membership
      WHERE membership.workspace_id = workspace_writer_policies.workspace_id
        AND membership.user_id = auth.uid()
        AND membership.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "workspace_writer_policies_update" ON workspace_writer_policies;
CREATE POLICY "workspace_writer_policies_update" ON workspace_writer_policies
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces AS workspace
      WHERE workspace.id = workspace_writer_policies.workspace_id
        AND workspace.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members AS membership
      WHERE membership.workspace_id = workspace_writer_policies.workspace_id
        AND membership.user_id = auth.uid()
        AND membership.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces AS workspace
      WHERE workspace.id = workspace_writer_policies.workspace_id
        AND workspace.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspace_members AS membership
      WHERE membership.workspace_id = workspace_writer_policies.workspace_id
        AND membership.user_id = auth.uid()
        AND membership.role = 'admin'
    )
  );

DROP TRIGGER IF EXISTS trg_workspace_writer_policies_touch ON workspace_writer_policies;
CREATE TRIGGER trg_workspace_writer_policies_touch
  BEFORE UPDATE ON workspace_writer_policies
  FOR EACH ROW EXECUTE FUNCTION touch_content_updated_at();

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
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  superseded_by UUID REFERENCES writer_review_bundles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT writer_review_approval_fields CHECK (
    status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
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

-- Atomic approval-to-delivery boundary. The service records approved_by while
-- the review remains pending; this transaction writes approved_at/status only
-- after every destination, gate and consent check succeeds.
CREATE OR REPLACE FUNCTION materialize_writer_bundle(
  p_workspace_id UUID,
  p_review_id UUID,
  p_snapshot_hash TEXT
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
  v_variant JSONB;
  v_post_group_id UUID;
  v_scheduled_at TIMESTAMPTZ;
  v_scheduled_tz TEXT;
  v_group_media JSONB;
  v_item_media JSONB;
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

  IF v_review.status = 'approved' AND v_item.post_group_id IS NOT NULL THEN
    post_group_id := v_item.post_group_id;
    created := false;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_review.status <> 'pending'
    OR v_review.approved_by IS NULL
    OR v_review.expires_at <= now()
    OR v_item.state <> 'awaiting_approval'
  THEN
    RAISE EXCEPTION 'Writer review is not approvable'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_writer_policies AS policy
    WHERE policy.workspace_id = p_workspace_id
      AND (
        policy.mode <> 'approval_required'
        OR policy.policy_version <> v_review.policy_version
      )
  ) OR (
    NOT EXISTS (
      SELECT 1
      FROM public.workspace_writer_policies AS policy
      WHERE policy.workspace_id = p_workspace_id
    )
    AND v_review.policy_version <> 1
  ) THEN
    RAISE EXCEPTION 'Writer policy changed after review creation'
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
  ) THEN
    RAISE EXCEPTION 'Writer review proof consent changed'
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
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.workspace_writer_policies AS policy
            WHERE policy.workspace_id = p_workspace_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.workspace_writer_policies AS policy
            WHERE policy.workspace_id = p_workspace_id
              AND connection.id = ANY(policy.allowed_connection_ids)
          )
        )
    ) THEN
      RAISE EXCEPTION 'Writer review destination or gate changed'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_scheduled_at :=
    (v_review.snapshot -> 'proposedSlot' ->> 'scheduledAt')::TIMESTAMPTZ;
  v_scheduled_tz := v_review.snapshot -> 'proposedSlot' ->> 'timezone';
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
        'alt_text', media ->> 'altText'
      )
      ORDER BY media ->> 'storageKey'
    ),
    '[]'::JSONB
  )
  INTO v_group_media
  FROM jsonb_array_elements(
    COALESCE(v_review.snapshot -> 'variants' -> 0 -> 'media', '[]'::JSONB)
  ) AS media_items(media);
  v_post_group_id := gen_random_uuid();

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
    v_review.snapshot -> 'contentItem' ->> 'canonicalContent',
    v_group_media,
    v_scheduled_at,
    v_scheduled_tz,
    false,
    v_review.snapshot -> 'variants' -> 0 ->> 'firstComment',
    'dashboard'
  );

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
          'alt_text', media ->> 'altText'
        )
        ORDER BY media ->> 'storageKey'
      ),
      '[]'::JSONB
    )
    INTO v_item_media
    FROM jsonb_array_elements(
      COALESCE(v_variant -> 'media', '[]'::JSONB)
    ) AS media_items(media);

    INSERT INTO public.post_items (
      post_group_id,
      connection_id,
      platform,
      adapted_content,
      resolved_content,
      media,
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
      'scheduled',
      (v_variant ->> 'id')::UUID
    );
  END LOOP;

  UPDATE public.content_items AS ci
  SET
    state = 'scheduled',
    state_entered_at = now(),
    post_group_id = v_post_group_id,
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
    v_review.approved_by::TEXT,
    jsonb_build_object('review_id', v_review.id, 'snapshot_hash', v_review.snapshot_hash)
  );

  UPDATE public.writer_review_bundles AS wr
  SET
    status = 'approved',
    approved_at = now()
  WHERE wr.id = v_review.id
    AND wr.workspace_id = p_workspace_id
    AND wr.status = 'pending';

  post_group_id := v_post_group_id;
  created := true;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION materialize_writer_bundle(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION materialize_writer_bundle(UUID, UUID, TEXT)
  TO service_role;
