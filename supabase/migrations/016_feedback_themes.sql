-- Plan 2 / Agent 2A — persistente Feedback-Themen + Proof-Vorschläge.
--
-- Warum eine eigene Tabelle statt Ad-hoc-Clustering pro Abfrage:
-- Cluster-IDENTITÄT muss über Läufe hinweg stabil bleiben. Würde jeder Lauf neu
-- clustern, spränge jedes Thema wöchentlich um und "Momentum" (2A.2) wäre reines
-- Rauschen statt Signal. Deshalb: der Zentroid wird persistiert, und ein neues
-- Thema entsteht nur, wenn KEIN bestehender Zentroid über der Ähnlichkeitsschwelle
-- liegt (lib/feedback/themes.ts, THEME_MATCH_THRESHOLD).
--
-- Momentum wird NICHT hier berechnet, sondern in TypeScript mit demselben
-- median/MAD-Verfahren wie lib/scoring/baseline.ts — ein Baseline-Konzept im
-- Projekt, nicht zwei.
--
-- IF NOT EXISTS überall: Re-Runs müssen folgenlos sein.

-- ============================================================
-- 1. Themen
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- Deterministisch aus den Mitgliedern abgeleitet (Top-Topics), kein LLM-Aufruf.
  keywords TEXT[] NOT NULL DEFAULT '{}',
  -- Der stabile Anker. NULL nur, wenn kein Embedding-Provider konfiguriert war.
  centroid VECTOR(1536),
  member_count INTEGER NOT NULL DEFAULT 0,
  -- Zählfenster für Momentum: aktuelles Fenster vs. Vorfenster (siehe themes.ts).
  recent_count INTEGER NOT NULL DEFAULT 0,
  previous_count INTEGER NOT NULL DEFAULT 0,
  -- 0..1, gespeist aus classifyOutcome() gegen die Wochenhistorie des Themas.
  momentum NUMERIC(6, 5) NOT NULL DEFAULT 0,
  momentum_ratio NUMERIC(10, 5),
  momentum_bucket TEXT CHECK (momentum_bucket IN ('below', 'inline', 'above', 'outlier')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_clustered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_themes_ws
  ON feedback_themes (workspace_id, status, momentum DESC);

ALTER TABLE feedback_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_themes_workspace" ON feedback_themes;
CREATE POLICY "feedback_themes_workspace" ON feedback_themes
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- 2. Mitgliedschaften
-- ============================================================
-- UNIQUE(workspace_id, feedback_item_id): ein Feedback gehört zu genau EINEM
-- Thema. Das macht den Clustering-Lauf idempotent — bereits zugeordnete Items
-- werden nicht erneut verarbeitet, und ein zweiter Lauf ohne neue Daten ist ein
-- No-Op (die Stabilitätsgarantie aus §8).

CREATE TABLE IF NOT EXISTS feedback_theme_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES feedback_themes(id) ON DELETE CASCADE,
  feedback_item_id UUID NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  similarity NUMERIC(6, 5),
  -- Zeitachse für Momentum: das Datum des Feedbacks, nicht des Clustering-Laufs.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, feedback_item_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_theme_members_theme
  ON feedback_theme_members (theme_id, occurred_at DESC);

ALTER TABLE feedback_theme_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_theme_members_workspace" ON feedback_theme_members;
CREATE POLICY "feedback_theme_members_workspace" ON feedback_theme_members
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- 3. Proof-Vorschläge (2A.3)
-- ============================================================
-- Harte Regel: aus Feedback extrahierte Belege werden NIE automatisch zu
-- proof_assets. Sie landen hier als Vorschlag und brauchen eine menschliche
-- Entscheidung. Ein automatisch erzeugter "Beleg" wäre exakt die Fabrikation,
-- gegen die das gesamte Proof-Konzept (Migration 012) gebaut wurde.

CREATE TABLE IF NOT EXISTS proof_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feedback_item_id UUID REFERENCES feedback_items(id) ON DELETE CASCADE,
  suggested_type TEXT NOT NULL CHECK (
    suggested_type IN ('metric', 'customer_quote', 'founder_observation', 'case_study', 'experiment')
  ),
  -- Wortlaut aus der Quelle. Nicht umformuliert — sonst ist die Quelle keine Quelle.
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 3 AND 2000),
  source_url TEXT,
  source_author TEXT,
  source_platform TEXT,
  -- Warum das Modell das für belegbar hält. Für den Menschen, der entscheidet.
  rationale TEXT,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  -- true = personenbezogene Aussage (Kundenzitat). Ohne Zustimmung nicht nutzbar.
  requires_consent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  proof_asset_id UUID REFERENCES proof_assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  -- Dedupe: derselbe Satz aus demselben Feedback wird nicht zweimal vorgeschlagen.
  UNIQUE (workspace_id, feedback_item_id, content)
);

CREATE INDEX IF NOT EXISTS idx_proof_suggestions_ws
  ON proof_suggestions (workspace_id, status, created_at DESC);

ALTER TABLE proof_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "proof_suggestions_workspace" ON proof_suggestions;
CREATE POLICY "proof_suggestions_workspace" ON proof_suggestions
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- 4. DSGVO-Spalten am proof_asset
-- ============================================================
-- Ohne diese Spalten kann das Quality-Gate (Plan 2 §6.2, Prüfung 1) nicht
-- unterscheiden, ob ein Kundenzitat eine Rechtsgrundlage hat. Default
-- 'not_required' hält bestehende Zeilen (eigene Metriken, Founder-Beobachtungen)
-- unverändert nutzbar; nur personenbezogene Belege müssen aktiv freigegeben werden.

ALTER TABLE proof_assets
  ADD COLUMN IF NOT EXISTS consent_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (consent_status IN ('not_required', 'pending', 'granted', 'denied')),
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ,
  -- Womit die Zustimmung belegt ist (E-Mail-Betreff, Ticket-Link, Vertragsklausel).
  ADD COLUMN IF NOT EXISTS consent_reference TEXT,
  -- Herkunft: aus welchem Feedback stammt der Beleg (NULL = manuell angelegt).
  ADD COLUMN IF NOT EXISTS source_feedback_item_id UUID
    REFERENCES feedback_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_author TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'feedback_suggestion'));

CREATE INDEX IF NOT EXISTS idx_proof_assets_consent
  ON proof_assets (workspace_id, consent_status);
