# TODOS

> Angelegt 2026-07-10 durch /plan-eng-review (GOAL-RUN5). Format: Was / Warum / Kontext / Abhängig von.

## 1. Dedizierter i18n-Run — Experience pro Sprache KOMPLETT machen

- **Was:** Katalog-Guidance (Namen, Beschreibungen, Slot-Fragen/help/example, Strategie-Panels, INTENT_INFO/ANLASS_INFO — ~350 Strings) nach DE/EN/ES; Post-Sprache an `voice_config.language` koppeln (render-prompt.ts, Scaffold, Hook-Formeln); Rest-Dashboard-Chrome migrieren.
- **Warum:** GOAL-RUN5 (T1-Entscheidung) hat bewusst nur das i18n-Fundament + Wizard-Chrome dreisprachig gebaut. UI-Sprache ohne Post-Sprache ist für EN/ES-Nutzer wertlos — beides muss zusammen kommen, sonst bleibt die Experience halb-deutsch.
- **Kontext:** `apps/web/lib/i18n/` (typisierte Dictionaries, getLocale, Cookie `prolora-locale`) existiert nach GOAL-RUN5. Die verworfene `LocalizedText`-Struktur ist in `1) Architekture/GOAL-RUN5-TEMPLATE-GUIDE.md` §Mehrsprachigkeit dokumentiert. Prüfen, ob bei App-weiter Migration next-intl das eigene Wörterbuch ersetzen soll (portiert 1:1).
- **Abhängig von:** GOAL-RUN5 fertig; auslösen, sobald EN/ES-Nutzer real werden (nicht vorher — Wettbewerbsanalyse: DACH-Fokus).

## 2. Playwright-E2E für den Wizard-Kernflow

- **Was:** Browser-Automatisierung (neue devDependency + Browser-Binaries) für die manuellen Gaps aus GOAL-RUN5: Happy Path Ziel→Anlass→Vorlage→Ausfüllen→Composer, Browser-Zurück je Schritt, Doppelklick-Schutz, Sprachumschalter, prefers-reduced-motion.
- **Warum:** vitest deckt die Logik ab, aber der klickbare Kernflow bleibt sonst bei jedem Run Hand-Test — das erodiert.
- **Kontext:** Test-Plan-Artefakt liegt unter `~/.gstack/projects/prolora/yannik-main-eng-review-test-plan-20260710-183221.md`. Offenes Design-Thema: Auth-Mocking vs. laufendes Supabase für echte Flows.
- **Abhängig von:** GOAL-RUN5 implementiert + einmal manuell verifiziert (Bible §19).

## 3. Eigene Template-Performance-Daten statt Studien-Benchmarks

- **Was:** `template_id` pro veröffentlichtem Post in post_groups-Metadaten führen; Analytics zeigt Engagement je Vorlage; Strategie-Panel blendet ab N≥5 eigenen Posts „Deine Realität: …" neben dem Studien-Benchmark ein.
- **Warum:** Die D4-Benchmarks (GOAL-RUN5) sind Fremd-Richtwerte mit Quelle — die eigenen Zahlen sind der einzige Benchmark, der wirklich zählt. Differenzierung, die Gratis-Tools nicht haben.
- **Kontext:** `post_items.metrics` existiert bereits; Andockpunkt Analytics-Seite. ⚠️ Braucht vermutlich eine kleine Schema-Erweiterung → Migrations-Rückfrage-Pflicht laut CLAUDE.md.
- **Abhängig von:** GOAL-RUN5 live + einige Wochen echter Template-Posts.

## 4. DESIGN.md via /design-consultation anlegen

- **Was:** Dokumentiertes Design-System (Tokens, Komponenten-Vokabular, Stil-Regeln) als DESIGN.md.
- **Warum:** Die Design-Review zu GOAL-RUN5 musste Stil-Regeln (Anti-Slop, Ein-Akzent, text-first, App-UI-Klassifikation) ad hoc herleiten; mit DESIGN.md kalibriert jede künftige UI-Arbeit automatisch.
- **Kontext:** Grundstock existiert: `apps/web/app/globals.css` (Teal #0F6E56, System-Font als bewusste Performance-Ausnahme, light-only — Dark Mode ist laut Token-Kommentar Phase 2) + „Design-Spezifikation" in `1) Architekture/GOAL-RUN5-TEMPLATE-GUIDE.md`.
- **Abhängig von:** sinnvoll NACH GOAL-RUN5 (dann existieren ChoiceCard/SlotField als reale Beispiele).
