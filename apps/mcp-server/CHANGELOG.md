# Changelog

## 1.1.0 — 2026-07-22 (GOAL-RUN10: MCP-Aktivierung)

### Kritischer Fix
- **Alle mutierenden Tools waren in 1.0.0 zur Laufzeit kaputt** („typedHandler is
  not a function"): Tools, die mit leeren Annotations `{}` registriert waren,
  verlor das MCP-SDK beim Overload-Matching den Handler. Betroffen waren u. a.
  `create_post`, `adapt_content`, `score_post`, `retry_post`,
  `draft_from_template` und mehrere Discovery-Tools. Read-Tools mit
  `readOnlyHint` funktionierten — deshalb blieb es in der statischen 1.0.0-Eval
  unentdeckt. Gefunden im ersten echten Live-Test gegen eine laufende Instanz.

### Neue Tools (9) — jetzt 38 gesamt
- `schedule_post` — bestehenden Post/Draft umplanen oder sofort veröffentlichen
  (`PATCH /posts/:id/schedule`), mit Client-seitigem XOR-Guard.
- `get_calendar` — Kalenderfenster (max. 62 Tage) inkl. Drafts-Rail (`GET /calendar`).
- `bulk_create_posts` — bis zu 100 Posts pro Aufruf (`POST /posts/bulk`).
- `get_optimal_times` — beste Posting-Fenster je Connection (`GET /connections/:id/optimal-times`).
- `get_posting_slot` — nächster freier Slot aus dem Posting-Plan (`POST /posting-schedules/next`).
- `add_content_source` / `list_content_sources` / `splinter_source` /
  `accept_splinter` — der komplette Splintering-Flywheel (GOAL-RUN6 §12).

### Drift-Fixes (Abgleich gegen die aktuelle v1-API)
- `create_post`: unterstützt jetzt `draft: true` (nur speichern, nichts posten)
  und `scheduled_tz` (IANA-Zeitzone).
- `list_posts`: neue Filter `platform`, `date_from`, `date_to` sowie die
  Status-Werte `publishing` und `deleted`.
- `list_templates`: Plattform-Filter kennt jetzt alle 8 Plattformen
  (inkl. discord/devto/hashnode) und den `format`-Filter.
- `validate_content`: Zeichenlimits für discord (2000), devto (10000) und
  hashnode (10000) ergänzt.

### Base-URL-Verhalten
- Startup-Ping gegen `/system/health` (non-blocking, nur stderr): Warnung mit
  Handlungsanweisung, wenn die API unter der konfigurierten URL nicht
  erreichbar ist — statt kryptischer Timeouts beim ersten Tool-Call.
- Netzwerk-/DNS-Fehler werfen jetzt eine klare deutsche Fehlermeldung inkl.
  Hinweis auf `PROLORA_BASE_URL`.

### Verifikation
- `tsc --noEmit` 0 Fehler; 38 Tools registriert; MCP-Handshake + `tools/list`
  per Stdio getestet.
- Live-E2E gegen lokale Instanz (echte DB): create draft → Kalender-Rail →
  reschedule mit Zeitzone → Kalender-Grid → XOR-Guard → Slot/Timing → delete.
  12/12 Checks bestanden.
- Web-Testsuite unangetastet grün (210/210).

## 1.0.0 — GOAL-RUN3

Initiale Version: 29 Tools (Publishing/Listening/Discovery), Stdio-Transport,
API-Key-Auth. Nie auf npm publiziert; Live-Verifikation stand aus.
