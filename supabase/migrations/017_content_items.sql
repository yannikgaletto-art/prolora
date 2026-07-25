-- Plan 2 / 2B.1 — Content-Fabrik: Zustandsmaschine + kanal-native Varianten.
--
-- Warum drei Tabellen statt einer:
--   content_items            = das Werkstück und sein aktueller Zustand
--   content_item_variants    = pro Kanal EIN eigenständiges Artefakt (kein
--                              gekürzter Klon — 2B.3)
--   content_item_transitions = das Protokoll. Jeder Übergang trägt `reason`
--                              und `actor`. Ein `rejected` ohne Grund ist ein
--                              Bug, kein Zustand — deshalb steht die Regel
--                              zusätzlich als CHECK in der Datenbank und nicht
--                              nur im Anwendungscode.
--
-- STOP-Gate (Plan 2 §9): Diese Migration wird NICHT automatisch angewendet.
-- Der Anwendungscode degradiert über isMissingSchemaError zu leeren Listen
-- bzw. 503 `migration_pending`, bis der Nutzer sie im SQL-Editor einspielt.

-- ---------------------------------------------------------------------------
-- content_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  state TEXT NOT NULL DEFAULT 'signal' CHECK (state IN (
    'signal', 'angled', 'concepted', 'drafted', 'gated',
    'scheduled', 'published', 'measured', 'rejected'
  )),

  -- Herkunft (Vertrag C3). signal_ref ist die ID aus lib/pipeline/inventory.ts;
  -- sie ist bewusst TEXT und keine FK: Signale sind abgeleitet, nicht gespeichert.
  signal_ref TEXT,
  signal_kind TEXT NOT NULL CHECK (signal_kind IN (
    'feedback_theme', 'unused_proof', 'community_question', 'splinter', 'winner_followup'
  )),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  strength REAL NOT NULL DEFAULT 0 CHECK (strength >= 0 AND strength <= 1),

  -- Die Herkunfts-Kette der UI liest hieraus ("Aus 23 Feedbacks -> Proof -> Prognose").
  evidence JSONB NOT NULL DEFAULT
    '{"proofAssetIds": [], "feedbackItemIds": [], "communityIds": [], "referenceIds": []}'::jsonb,

  -- Frequenz-Motor (2B.4): der Scheduler wählt nach Mix, nicht nach Reihenfolge.
  mix_bucket TEXT NOT NULL DEFAULT 'insight'
    CHECK (mix_bucket IN ('insight', 'proof', 'story', 'question')),

  angle JSONB,
  concept JSONB,
  gate_result JSONB,

  -- Ein rejected ohne Grund ist ein Bug (Plan 2 §2).
  rejected_reason TEXT,

  stale_after TIMESTAMPTZ,
  -- Failure Mode §8: kein Item darf in einem Zwischenzustand hängenbleiben.
  state_entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stalled_at TIMESTAMPTZ,

  post_group_id UUID REFERENCES post_groups(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_items_rejected_needs_reason CHECK (
    state <> 'rejected'
    OR (rejected_reason IS NOT NULL AND char_length(btrim(rejected_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_content_items_ws_state
  ON content_items (workspace_id, state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_items_stall_sweep
  ON content_items (state, state_entered_at)
  WHERE state NOT IN ('published', 'measured', 'rejected');

CREATE INDEX IF NOT EXISTS idx_content_items_scheduled
  ON content_items (workspace_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

-- Ein Signal wird nur einmal zu einem Werkstück (Orchestrator-Idempotenz).
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_items_signal_ref
  ON content_items (workspace_id, signal_ref)
  WHERE signal_ref IS NOT NULL;

ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_items_workspace" ON content_items;
CREATE POLICY "content_items_workspace" ON content_items
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- content_item_variants — pro Kanal ein eigenes Artefakt
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_item_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  -- workspace_id wird denormalisiert mitgeführt, damit jede Query der
  -- Invariante 2 (explizites workspace_id-Scoping) ohne Join genügen kann.
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Kanal = Konto, nicht Plattform. Ohne Verbindung: "platform:<name>".
  channel_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id UUID REFERENCES platform_connections(id) ON DELETE SET NULL,

  format TEXT NOT NULL DEFAULT 'post' CHECK (format IN ('post', 'thread', 'article')),
  content TEXT NOT NULL,
  -- Thread-Teile bzw. Abschnitte; leer bei format='post'.
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Resonanz-Schema aus Migration 013 (Gate-Prüfung 2).
  structure JSONB,
  proof_asset_ids UUID[] NOT NULL DEFAULT '{}',

  gate_result JSONB,
  gate_passed BOOLEAN,

  -- Entscheidung D1: Das Gate verweigert hart. Übersteuern ist erlaubt, aber
  -- nur mit Protokoll — ohne Protokoll ist ein Gate nur eine Bitte.
  overridden_by TEXT,
  overridden_at TIMESTAMPTZ,
  override_reason TEXT,

  -- Selbstähnlichkeits-Prüfung (Gate 4) gegen die eigenen letzten 90 Tage.
  embedding VECTOR(1536),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT content_item_variants_override_needs_reason CHECK (
    overridden_by IS NULL
    OR (override_reason IS NOT NULL AND char_length(btrim(override_reason)) > 0
        AND overridden_at IS NOT NULL)
  ),
  CONSTRAINT content_item_variants_unique_channel UNIQUE (content_item_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_content_item_variants_item
  ON content_item_variants (content_item_id);

CREATE INDEX IF NOT EXISTS idx_content_item_variants_ws
  ON content_item_variants (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_item_variants_embedding
  ON content_item_variants USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE content_item_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_item_variants_workspace" ON content_item_variants;
CREATE POLICY "content_item_variants_workspace" ON content_item_variants
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- content_item_transitions — das Protokoll
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_item_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  -- Kein Übergang ohne Grund und ohne Verursacher.
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  actor TEXT NOT NULL CHECK (actor IN ('system', 'user')),
  actor_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_item_transitions_item
  ON content_item_transitions (content_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_item_transitions_ws
  ON content_item_transitions (workspace_id, created_at DESC);

ALTER TABLE content_item_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_item_transitions_workspace" ON content_item_transitions;
CREATE POLICY "content_item_transitions_workspace" ON content_item_transitions
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- Selbstähnlichkeit (Gate-Prüfung 4) — dieselbe Infrastruktur wie
-- match_feedback_embeddings aus Migration 003, nur auf den eigenen Varianten.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_content_variant_embeddings(
  query_embedding VECTOR(1536),
  match_workspace_id UUID,
  match_threshold FLOAT DEFAULT 0.90,
  match_since TIMESTAMPTZ DEFAULT (now() - INTERVAL '90 days'),
  exclude_variant_id UUID DEFAULT NULL,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content_item_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    v.id,
    v.content_item_id,
    1 - (v.embedding <=> query_embedding) AS similarity
  FROM content_item_variants v
  WHERE v.workspace_id = match_workspace_id
    AND v.embedding IS NOT NULL
    AND v.created_at >= match_since
    AND (exclude_variant_id IS NULL OR v.id <> exclude_variant_id)
    AND 1 - (v.embedding <=> query_embedding) > match_threshold
  ORDER BY v.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Wie viele eigene Posts liegen als Vergleichsbasis vor? Unter der Schwelle
-- wird Gate-Prüfung 4 ÜBERSPRUNGEN und sichtbar als übersprungen gemeldet —
-- niemals als "bestanden" (Plan 2 §8).
CREATE OR REPLACE FUNCTION content_variant_history_size(
  match_workspace_id UUID,
  match_since TIMESTAMPTZ DEFAULT (now() - INTERVAL '90 days')
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM content_item_variants v
  WHERE v.workspace_id = match_workspace_id
    AND v.embedding IS NOT NULL
    AND v.created_at >= match_since;
$$;

-- updated_at pflegen (dieselbe Handhabung wie in den früheren Migrationen:
-- ein Trigger je Tabelle, keine Anwendungslogik).
CREATE OR REPLACE FUNCTION touch_content_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_items_touch ON content_items;
CREATE TRIGGER trg_content_items_touch
  BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION touch_content_updated_at();

DROP TRIGGER IF EXISTS trg_content_item_variants_touch ON content_item_variants;
CREATE TRIGGER trg_content_item_variants_touch
  BEFORE UPDATE ON content_item_variants
  FOR EACH ROW EXECUTE FUNCTION touch_content_updated_at();
