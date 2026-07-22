-- GOAL-RUN9 Phase 1: curated pattern library (D2). workspace_id NULL = global
-- curated seed row visible to every workspace; non-NULL = workspace-owned
-- (future auto-research). Honesty invariant: engagement is only shown in the
-- UI when the JSON is present AND verified_at is set — reference posts whose
-- metrics cannot be re-verified stay NULL and render as "unverifiziert".

CREATE TABLE IF NOT EXISTS content_references (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('reddit', 'x', 'linkedin', 'instagram')),
  source_url TEXT,
  author_name TEXT,
  published_at TIMESTAMPTZ,
  engagement JSONB,
  reference_type TEXT NOT NULL CHECK (reference_type IN (
    'data_analysis', 'strategy_change', 'founder_story', 'mistake_to_learning',
    'contrarian_take', 'framework', 'case_study'
  )),
  hook TEXT NOT NULL,
  structure JSONB NOT NULL,
  why_it_worked TEXT[] NOT NULL DEFAULT '{}',
  reusable_pattern TEXT NOT NULL,
  relevance_tags TEXT[] NOT NULL DEFAULT '{}',
  relevance_score SMALLINT NOT NULL DEFAULT 50 CHECK (relevance_score BETWEEN 0 AND 100),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_references_ws
  ON content_references (workspace_id, relevance_score DESC);

ALTER TABLE content_references ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_references_read" ON content_references;
CREATE POLICY "content_references_read" ON content_references
  FOR SELECT USING (
    workspace_id IS NULL OR workspace_id IN (SELECT public.user_workspace_ids())
  );

DROP POLICY IF EXISTS "content_references_write" ON content_references;
CREATE POLICY "content_references_write" ON content_references
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

-- ---------------------------------------------------------------------------
-- Curated seed (T3 research, 2026-07). Fixed UUIDs + ON CONFLICT DO NOTHING
-- make this migration the idempotent seed script. All German by design (DACH).
-- Resonance schema used by every structure JSON:
--   beweisbarer_ausgangspunkt -> bruch -> unerwarteter_befund -> mechanismus
--   -> handlungsregel -> reibungsfrage
-- ---------------------------------------------------------------------------

INSERT INTO content_references
  (id, workspace_id, platform, source_url, engagement, reference_type, hook, structure, why_it_worked, reusable_pattern, relevance_tags, relevance_score, verified_at)
VALUES
(
  'a1000000-0000-4000-8000-000000000001', NULL, 'reddit', NULL, NULL,
  'framework',
  'Ich habe [X] analysiert. Meine Annahme war nur teilweise richtig.',
  '{"beweisbarer_ausgangspunkt": "Umfang der eigenen Analyse nennen (Anzahl, Zeitraum)", "bruch": "Die eigene Annahme benennen — und dass sie nur teilweise stimmte", "unerwarteter_befund": "Der stärkste Unterschied lag bei einem konkreten, unerwarteten Signal", "mechanismus": "Warum Verhalten A funktionierte und Verhalten B früh aus dem Prozess flog", "handlungsregel": "Eine harte, merkfähige Regel + ein konkreter erster Schritt", "reibungsfrage": "Welche Regel würdest du gern einmal mit echten Daten überprüfen?"}',
  ARRAY[
    'Zahlen allein ziehen nicht — sie müssen eine offene Frage erzeugen',
    'Die relevante Einheit ist eine Entscheidung, nicht ein Thema',
    'Selbst erhobene Daten schlagen zitierte Studien'
  ],
  'Analyse-Post: Umfang nennen → Annahme benennen → teilweise falsch → konkretes Signal → harte Regel → konkreter Schritt → Reibungsfrage',
  ARRAY['analyse', 'daten', 'authority', 'productEducation'],
  90, now()
),
(
  'a1000000-0000-4000-8000-000000000002', NULL, 'reddit', NULL, NULL,
  'strategy_change',
  'Wir haben unsere Strategie bei [Produkt] geändert. Nicht alles wurde besser.',
  '{"beweisbarer_ausgangspunkt": "Alte Strategie + die Annahme dahinter", "bruch": "Messbare oder konkrete Reibung, die die Annahme widerlegte", "unerwarteter_befund": "Neue Entscheidung getestet — nicht alles besser, aber ein relevanter Effekt", "mechanismus": "Das Prinzip hinter der Veränderung (nie das Rezept)", "handlungsregel": "Bei kleinen Teams ist die ungetestete Annahme der Engpass, nicht die Idee", "reibungsfrage": "Welche Annahme in deinem Prozess wurde nie getestet?"}',
  ARRAY[
    'Ehrliches Zwischenergebnis (nicht alles wurde besser) schlägt Erfolgsmeldung',
    'Prinzip statt Rezept macht die Lektion übertragbar',
    'Build-in-public wirkt nur mit echter Entscheidung + Konsequenz'
  ],
  'Strategiewechsel-Post: vorher [alt] wegen [Annahme] → Reibung → [neu] getestet → gemischtes Ergebnis → Prinzip',
  ARRAY['strategie', 'buildInPublic', 'founder', 'personalStory'],
  85, now()
),
(
  'a1000000-0000-4000-8000-000000000003', NULL, 'reddit', NULL, NULL,
  'contrarian_take',
  'Die meisten optimieren an der falschen Stelle.',
  '{"beweisbarer_ausgangspunkt": "Drei Dinge, die alle tun (feilen, verschönern, umschreiben)", "bruch": "Wenn ein frühes Signal im Prozess nicht stimmt, wird all das nie gelesen", "unerwarteter_befund": "Das konkrete Erlebnis / der Datensatz, der das gezeigt hat", "mechanismus": "Warum die frühe Stufe die späte unsichtbar macht", "handlungsregel": "Prüfreihenfolge als 3-Punkte-Checkliste, erst danach Sprache optimieren", "reibungsfrage": "Offene Position, die zu Gegenargumenten einlädt"}',
  ARRAY[
    'Negative oder kontraintuitive Erkenntnisse lösen mehr Diskussion aus als Erfolgsmeldungen',
    'Der Widerspruch muss belegt sein, sonst ist es nur Meinung'
  ],
  'Anti-Intuition-Post: verbreitetes Verhalten → warum es ins Leere läuft → Beleg → neue Prüfreihenfolge → Position',
  ARRAY['kontraintuitiv', 'community', 'authority'],
  85, now()
),
(
  'a1000000-0000-4000-8000-000000000004', NULL, 'reddit',
  'https://www.reddit.com/r/productivity/', '{"likesOrUpvotes": null, "commentsOrReplies": null}',
  'data_analysis',
  'I analyzed every post in this sub for 6 weeks',
  '{"beweisbarer_ausgangspunkt": "982 Posts und ~10.000 Kommentare selbst ausgewertet", "bruch": "These gegen verbreitete Best-of-Listen", "unerwarteter_befund": "Kontraintuitive Rangfolge mit konkreten Zahlen je Tool", "mechanismus": "Interpretation, warum Hype und Alltagsnutzung auseinanderlaufen", "handlungsregel": "Empfehlung auf Basis der Daten, nicht des Hypes", "reibungsfrage": "Leser vergleichen ihre eigene Erfahrung mit der Rangfolge"}',
  ARRAY['Selbst erhobener Datensatz + These gegen den Konsens', 'Konkrete Nennungen einzelner Tools machen es nachprüfbar'],
  'Umfang nennen → Datensatz erklären → kontraintuitive Rangfolge → konkrete Zahlen → Interpretation',
  ARRAY['analyse', 'daten', 'authority'],
  75, NULL
),
(
  'a1000000-0000-4000-8000-000000000005', NULL, 'reddit',
  'https://www.reddit.com/r/SideProject/', '{"likesOrUpvotes": null, "commentsOrReplies": null}',
  'founder_story',
  'I built an app that analyzes 23 million Reddit posts',
  '{"beweisbarer_ausgangspunkt": "Produktbeweis: 23 Mio. Posts analysiert", "bruch": "Ernüchternde Realität: typische Build-in-public-Posts erhalten kaum Resonanz", "unerwarteter_befund": "Nachprüfbare Signale (zahlende Kunden, Umsatz, Nutzerzahlen) erzeugen Aufmerksamkeit — generische Updates nicht", "mechanismus": "Nachprüfbarkeit schlägt Enthusiasmus", "handlungsregel": "Poste Belege, keine Fortschrittsmeldungen", "reibungsfrage": "Was wäre dein nachprüfbares Signal?"}',
  ARRAY['Contrarian-Befund aus eigenem Produktdatensatz', 'Der Post praktiziert selbst, was er empfiehlt'],
  'Produktbeweis → ernüchternde Realität → Messwerte → Muster → klare Alternative',
  ARRAY['founder', 'buildInPublic', 'daten'],
  75, NULL
),
(
  'a1000000-0000-4000-8000-000000000006', NULL, 'reddit',
  'https://www.reddit.com/r/jobs/', '{"likesOrUpvotes": null, "commentsOrReplies": null}',
  'mistake_to_learning',
  '50+ applications in and I finally worked out what I was doing wrong',
  '{"beweisbarer_ausgangspunkt": "50+ Bewerbungen ohne Erfolg", "bruch": "Der präzise benannte Fehler: ein generisches CV", "unerwarteter_befund": "Eine kleine Intervention (oberste CV-Sektion je Rolle zuschneiden) änderte die Quote", "mechanismus": "Warum die erste Sektion über Lesen oder Wegklicken entscheidet", "handlungsregel": "Vor jeder Bewerbung genau eine Sektion maßschneidern", "reibungsfrage": "Emotionaler Abschluss + Frage nach eigenen Erfahrungen"}',
  ARRAY['Scheitern + präzise Diagnose macht die Story persönlich UND kopierbar', 'Eine konkrete Intervention statt zehn Tipps'],
  'Scheitern → falsche Vorgehensweise → konkrete Änderung → beobachtetes Resultat → emotionaler Abschluss',
  ARRAY['personalStory', 'fehler', 'community', 'bewerbung'],
  80, NULL
),
(
  'a1000000-0000-4000-8000-000000000007', NULL, 'reddit',
  'https://www.reddit.com/r/jobsearchhacks/', '{"likesOrUpvotes": null, "commentsOrReplies": null}',
  'case_study',
  'What I''ve learned from 4,500+ job applications',
  '{"beweisbarer_ausgangspunkt": "Extremzahl: 4.500+ Bewerbungen", "bruch": "Schmerz statt Motivation — Leser erwarten harte Erkenntnisse", "unerwarteter_befund": "Verdichtete Lernkurve aus ungewöhnlich langem Prozess", "mechanismus": "Autorität UND Empathie aus derselben Zahl", "handlungsregel": "Die 3 Dinge, die tatsächlich einen Unterschied machten", "reibungsfrage": "Welche davon widerspricht deiner Erfahrung?"}',
  ARRAY['Die Extremzahl allein schafft Autorität und Empathie zugleich'],
  'Extremzahl → Schmerz → Versprechen einer verdichteten Lernkurve → harte Erkenntnisse',
  ARRAY['personalStory', 'analyse', 'bewerbung'],
  70, NULL
)
ON CONFLICT (id) DO NOTHING;
