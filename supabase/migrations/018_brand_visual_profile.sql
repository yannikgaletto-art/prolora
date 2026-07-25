-- Plan 2 / Agent 2A — Brand-Visual-Profile (2A.5) + plan-abhängiges Media-Budget (D3).
--
-- Warum ein Visual-Profil überhaupt: bei 75 Posts im Monat entsteht ohne
-- verbindliche Palette/Typografie visueller Wildwuchs, und die Marke verschwindet
-- zwischen den eigenen Beiträgen. Das Profil fließt in JEDEN Bild-Prompt und in
-- jedes deterministische Template (lib/media/visual-templates/**).
--
-- Ein Zeile pro Workspace (UNIQUE). Fehlt die Zeile, greifen die Defaults aus
-- lib/media/brand-profile.ts — die Templates rendern also auch ohne Setup.
--
-- IF NOT EXISTS überall: Re-Runs müssen folgenlos sein.

CREATE TABLE IF NOT EXISTS brand_visual_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Palette. Hex mit führendem # — validiert, damit kein CSS-Injektionsvektor
  -- über die Farbe in den SVG-Renderer läuft (satori bekommt diese Werte roh).
  color_primary    TEXT NOT NULL DEFAULT '#111827' CHECK (color_primary    ~ '^#[0-9A-Fa-f]{6}$'),
  color_secondary  TEXT NOT NULL DEFAULT '#4B5563' CHECK (color_secondary  ~ '^#[0-9A-Fa-f]{6}$'),
  color_accent     TEXT NOT NULL DEFAULT '#2563EB' CHECK (color_accent     ~ '^#[0-9A-Fa-f]{6}$'),
  color_background TEXT NOT NULL DEFAULT '#FFFFFF' CHECK (color_background ~ '^#[0-9A-Fa-f]{6}$'),
  color_foreground TEXT NOT NULL DEFAULT '#111827' CHECK (color_foreground ~ '^#[0-9A-Fa-f]{6}$'),
  color_muted      TEXT NOT NULL DEFAULT '#6B7280' CHECK (color_muted      ~ '^#[0-9A-Fa-f]{6}$'),

  -- Typografie. `font_family` ist ein Anzeigename; welche Schriftdatei der
  -- Renderer tatsächlich lädt, entscheidet lib/media/visual-templates/render.ts.
  font_family TEXT NOT NULL DEFAULT 'Noto Sans',
  font_scale NUMERIC(3, 2) NOT NULL DEFAULT 1.00 CHECK (font_scale BETWEEN 0.60 AND 2.00),
  heading_weight SMALLINT NOT NULL DEFAULT 700
    CHECK (heading_weight IN (400, 500, 600, 700, 800, 900)),
  corner_radius SMALLINT NOT NULL DEFAULT 24 CHECK (corner_radius BETWEEN 0 AND 96),

  -- Bildsprache: geht als Text in jeden generierten Bild-Prompt.
  imagery_style TEXT,
  imagery_avoid TEXT[] NOT NULL DEFAULT '{}',

  -- Invariante 6 / R2: Medien werden als Storage-Key referenziert, nie als URL.
  logo_storage_key TEXT,
  logo_placement TEXT NOT NULL DEFAULT 'bottom_left'
    CHECK (logo_placement IN ('none', 'top_left', 'top_right', 'bottom_left', 'bottom_right')),
  watermark_text TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_visual_profiles_ws
  ON brand_visual_profiles (workspace_id);

ALTER TABLE brand_visual_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand_visual_profiles_workspace" ON brand_visual_profiles;
CREATE POLICY "brand_visual_profiles_workspace" ON brand_visual_profiles
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================================
-- Entscheidung D3 — plan-abhängiges Media-Budget
-- ============================================================
-- Bisher war die Grenze eine harte Konstante (MEDIA_BUDGET_LIMIT_EUR = 10 in
-- lib/media/generation.ts). 10 EUR erlauben ~83 Generierungen ohne jede
-- Verwerfung — Qualität entsteht aber durch Auswahl.
--
-- Was NICHT angefasst wird: das Ledger (media_budget_ledger) und die atomare
-- Reservierungs-RPC reserve_media_budget. Nur der übergebene p_limit wird
-- dynamisch. Die Sperr- und Buchungslogik bleibt Zeile für Zeile dieselbe.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS media_budget_limit_eur NUMERIC(8, 2) NOT NULL DEFAULT 10
    CHECK (media_budget_limit_eur >= 0);

-- Bestehende Workspaces auf ihre Plan-Grenze heben. Idempotent für Starter;
-- ein manuell heruntergesetzter Pro-Workspace würde bei einem Re-Run wieder
-- auf 60 gesetzt — bewusst in Kauf genommen, damit der Plan-Default gilt.
UPDATE workspaces
SET media_budget_limit_eur = CASE plan
  WHEN 'pro' THEN 60
  WHEN 'agency' THEN 200
  ELSE 10
END
WHERE media_budget_limit_eur = 10;
