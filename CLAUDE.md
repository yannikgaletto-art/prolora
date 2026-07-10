# Prolora — Onboarding für Agenten

Dieses Dokument ist der Einstiegspunkt für jeden Agenten (Claude Code oder sonstige), der in diesem Repo arbeitet. Lies es vollständig, bevor du Code änderst.

## Was ist Prolora?

Prolora (Codename in den Architektur-Docs: **EchoHub**) ist eine DSGVO-konforme **Publishing-API + Feedback-Aggregation** für den DACH-Markt — sinngemäß "Publora + ProductBridge in einem Produkt". Drei Schichten:

- **Schicht A — Publish**: Social-Media-Posts über eine REST-API/Dashboard/MCP auf mehreren Plattformen gleichzeitig veröffentlichen (LinkedIn, X, Bluesky, Mastodon, Telegram; Meta/TikTok/YouTube sind Phase 2 und noch nicht gebaut).
- **Schicht C — Listen**: Feedback aus Trustpilot, Google Reviews, Reddit, X-Mentions, einem eigenen Widget etc. einsammeln, per LLM analysieren (Sentiment, Kategorie, Urgency), deduplizieren (pgvector-Embeddings).
- **Schicht D — Discovery**: Reddit-Communities zu einem Workspace-Thema finden, relevante Threads erkennen, KI-gestützte Antwortentwürfe schreiben (bewusst *kein* automatisches Posten — siehe FABLE-04, das wird als ethisch fragwürdig eingestuft und vermieden).

Dazu kommt ein **MCP-Server**, der Publish/Listen/Discover-Funktionen direkt in Claude verfügbar macht.

## Naming

Das Produkt hieß in einer früheren Phase **EchoHub** und wurde zu **Prolora** umbenannt. Code und Architektur-Docs (`1) Architekture/`, inkl. der umbenannten `prolora-implementation-spec.md`) sind durchgängig auf "Prolora" vereinheitlicht (`x-prolora-key` Header, `PROLORA_API_KEY`, `@prolora/web`/`@prolora/mcp-server`/`@prolora/shared`, `ProloraClient`, "prolora.eu"). Falls dir irgendwo noch "EchoHub"/"echohub" begegnet (z. B. in Notizen außerhalb des Repos oder in `.claude/settings.local.json`-Permission-Caches), ist das ein Überbleibsel und sollte auf "Prolora" korrigiert werden.

## Repo-Layout

```
(8) Prolora /                          ← Projekt-Wurzel (kein Git-Repo!)
├── 1) Architekture/                   ← Spec- und Planungsdokumente (siehe unten)
├── 2) Knowledge Database/             ← Externe Referenz-Repos/Skills, nicht Teil des Produkts
├── 3) Research/                       ← Recherche-Notizen
└── prolora/                           ← Der eigentliche Code-Monorepo (npm workspaces)
    ├── apps/
    │   ├── web/                       ← Next.js 15 App-Router-App (Dashboard + REST-API)
    │   └── mcp-server/                ← Standalone MCP-Server (@modelcontextprotocol/sdk)
    ├── packages/
    │   └── shared/                    ← Geteilte Zod-Schemas & Types (@prolora/shared)
    └── supabase/
        └── migrations/                ← 001_initial_schema, 002_rls_policies, 003_functions, 004_indexes
```

**`apps/web/lib/` ist das Herz des Backends**, in Bereiche gegliedert: `adapters/` (Plattform-Adapter), `auth/` (OAuth + Token-Lifecycle), `posts/`, `feedback/`, `board/`, `changelog/`, `discovery/`, `listeners/`, `ai/` (Anthropic-Aufrufe), `media/` (Sharp-Transforms), `validation/`, `workspace/`, `settings/`, `gdpr/`, `supabase/` (Client-Factories), `inngest/` (Background-Jobs), `db.ts` (zentrale Row-Types), `env.ts` (Zod-validierte Env-Vars).

`apps/web/app/api/` enthält 33 Route-Handler, `app/(dashboard)/` das Dashboard, `app/board/[slug]` das öffentliche Feedback-Board, `app/(auth)/` Login/Register.

## Woher kommt die "Wahrheit"? — Die Architektur-Docs

Unter `1) Architekture/` liegt kein Prosa-Design-Dokument, sondern eine Reihe **agentenausführbarer Bauanleitungen mit Guardrails und Verifikations-Checklisten**. Reihenfolge, wenn du etwas nachschlagen willst:

1. **`Fundament.md`** — die ursprüngliche Vollspezifikation (Publishing-API, Feedback-Aggregation, MCP-Server, Datenmodell). Guter Startpunkt für "was soll das Feature X eigentlich tun", aber nicht immer 1:1 mit dem aktuellen Code (siehe Naming-Drift).
2. **`FABLE-01` bis `FABLE-04`** — Deep-Dives zu einzelnen Subsystemen:
   - FABLE-01: OAuth/Token-Lifecycle (Advisory-Lock-Refresh, PKCE, Verschlüsselung mit Key-Rotation)
   - FABLE-02: Platform-Adapter & Publishing-Pipeline
   - FABLE-03: Risikomatrix (12 durchnummerierte Risiken R1–R12) + Sicherheits-Invarianten
   - FABLE-04: Discovery-Layer (Wettbewerbsanalyse, Zwei-Stufen-Keyword→LLM-Filter)
3. **`FABLE-05-Execution-Prompt.md`** — der Master-Prompt, der den Backend-Bau tatsächlich angestoßen hat. Definiert 4 Phasen (A: OAuth, B: Publishing, C: Feedback, D: Discovery), eine Liste verbotener Dateien ("Sperrzone") und **9 nummerierte Sicherheits-Invarianten (Invariante 1–6 + D1–D3)** — diese Invarianten sind projektweit bindend, nicht optional.
4. **`GOAL-RUN1-BACKEND.md` / `GOAL-RUN2-FRONTEND.md` / `GOAL-RUN3-MCP-SERVER.md`** — konkrete Baupläne mit MUST/SHOULD/COULD-Priorisierung und "Verhaltens-Oracles" (Laufzeit-Verhaltenschecks, nicht nur Compile-Checks) als Definition-of-Done. Dazu **`GOAL-RUN4-POST-TEMPLATES.md`** (mehrschichtige Post-Vorlagen mit KI-Draft) — umgesetzt am 2026-07-10 (MUST T0–T2 + MCP-Tools T3: Katalog in `lib/templates/`, Routen unter `api/v1/templates/`, Composer-Integration via `TemplatePicker`; grep-Oracles + `tsc` verifiziert, Laufzeit-UI-Test steht aus). Recherche-Grundlage mit Quellen liegt in `3) Research/Post-Vorlagen-Recherche-2026-07.md`.

**Projektstatus:** Alle drei GOAL-RUN-Phasen sind laut Code-Zustand durchlaufen (0 TODOs, `tsc --noEmit` sauber in beiden Apps, 26/27 MCP-Tools). Das Projekt befindet sich in einer **Polish-/Lückenschluss-Phase**, nicht im Erstaufbau. Bekannte offene Punkte:
- MCP-Tool `get_usage` fehlt (COULD-Priorität, Credit-Verbrauch abfragen).
- Daily-Digest-E-Mail-Templates sind ein bewusster No-Op-Stub (`lib/inngest/functions/metrics-webhooks.ts`, Resend-Integration).

## Sicherheits-Invarianten (verbindlich, aus FABLE-05)

Diese ziehen sich als Kommentare durchs ganze `lib/`-Verzeichnis (z. B. `// Invariante 2`) — verletze sie nicht, wenn du neuen Code schreibst:

- **Invariante 2**: Der Service-Role-Client (`getServiceDb()`, umgeht RLS) darf **niemals** ohne explizites `workspace_id`-Scoping verwendet werden. RLS-Policies in `002_rls_policies.sql` existieren als Defense-in-Depth, sind aber **nicht** der primäre Zugriffsschutz — das ist Anwendungscode.
- **Kein `select('*')` auf sensiblen Tabellen**: stattdessen explizite Spalten-Allowlists (Muster: `PUBLIC_BOARD_ITEM_COLUMNS`, GDPR-Export-`COLUMNS`), um PII/Secrets (Tokens, `sk_live_...`, Embeddings) nicht versehentlich zu leaken.
- **"Double Assurance"-Pattern** bei kritischen Writes (Post-Erstellung, Board-Items): Write → Read-Back → Verify, bevor Erfolg zurückgemeldet wird.
- **Invariante 6 / R2**: Media wird als Storage-Key referenziert, nicht als (ablaufende) URL.
- **Listener dürfen nie werfen** (`poll()` immer fangen) — Dedupe über DB-`UNIQUE`-Constraints + `upsert(...ignoreDuplicates)`.
- Details und die volle Liste (D1–D3 für Discovery) stehen in FABLE-05 und FABLE-03.

## Wann stoppen und nachfragen (statt zu raten)

Bei diesen Situationen: Arbeit unterbrechen und beim Nutzer nachfragen, statt anzunehmen —

- Änderungen an Auth, Billing, DSGVO-/Datenschutz-Flows oder am DB-Schema (s. Migrations-Guardrail oben).
- Löschen von Nutzerdaten.
- Einführung einer neuen externen Abhängigkeit oder eines neuen Drittanbieter-Service (npm-Paket, API, SaaS).
- Ersetzen einer funktionierenden Implementierung statt sie chirurgisch zu patchen.
- Zwei Quellen widersprechen sich (z. B. Architektur-Doc vs. tatsächlicher Code) und die Diskrepanz ist für die aktuelle Aufgabe relevant.
- Jede sonst irreversible oder nach außen sichtbare Aktion (Force-Push, Branch löschen, Deploys außerhalb des normalen `main`-Push-Flows).

Hat der Nutzer für genau dieses Risiko bereits explizit zugestimmt: weitermachen, aber den Blast-Radius kurz benennen.

Für nicht-triviale Bugs bzw. vor dem Melden von "fertig": die Skills `systematic-debugging` bzw. `verification-before-completion` nutzen, statt aus dem Bauch heraus zu reparieren/abzuhaken.

## Coding-Konventionen

- **Supabase-Clients** — drei getrennte Factories, nie mischen:
  - `createSupabaseServerClient()` (`lib/supabase/server.ts`) — SSR, cookie-basiert, Server Components/Route Handlers mit Nutzer-Session.
  - `createSupabaseServiceClient()` / `getServiceDb()` (`lib/db.ts`) — Service-Role, umgeht RLS, **immer** mit explizitem `workspace_id`-Filter.
  - `createSupabaseBrowserClient()` (`lib/supabase/client.ts`) — Client Components.
- **Auth in API-Routes**: einheitlich über `getWorkspaceId(req)` / `authenticate(req)` aus `lib/api/auth-middleware.ts`. Zwei Pfade: `x-prolora-key`-Header (SHA-256-Hash-Lookup, `timingSafeEqual`) oder Supabase-Session-Cookie.
- **Fehlerbehandlung**: zentrale `ApiError`-Klasse (`lib/api/http.ts`) + `handleRouteError(context, error)`. `ZodError` → 400 mit Feld-Details, alles andere → generisches 500 (kein Stacktrace nach außen, nur server-seitiges `console.error`). Jede Route: try/catch → `handleRouteError`.
- **Zod**: geteilte Request-Schemas in `packages/shared/validation.ts` (Import als `@prolora/shared`), routen-lokale Query-Schemas inline im Route-File. `z.coerce.number()` für Query-Params, `.datetime()` für ISO-Daten.
- **Logging**: durchgängige `[modul]`- bzw. `[modul:subtyp]`-Präfix-Konvention (`[board]`, `[listener:reddit]`, `[gdpr]`, `[create-post]`) — bitte beibehalten.
- **TypeScript**: `strict: true`, kein `any`, `unknown` + Zod/Type-Guards für externe Daten. Path-Aliase: `@/*` → App-Root, `@prolora/shared` → `packages/shared`.
- **Row-Types**: zentral in `lib/db.ts` (`*Row`-Suffix), bewusst *nicht* aus generierten Supabase-Types — die spiegeln `supabase/migrations/001` manuell. Wenn du das Schema änderst, `lib/db.ts` mitpflegen (oder `npm run db:types`, s. u.).
- **Datei-Header-Kommentare**: viele `lib/`-Dateien beginnen mit 1–4 Zeilen, die auf eine Invariante/FABLE-Sektion verweisen ("Warum", nicht "Was"). Dieses Muster fortführen, wenn eine nicht offensichtliche Design-Entscheidung dahintersteckt — sonst keine Kommentare.

## Datenbank

4 Migrationen in `supabase/migrations/`, 20 Tabellen, `pgvector` + `pgcrypto` Extensions. Gruppen: Core (`workspaces`, `workspace_members`, `api_keys`), Publish (`platform_connections`, `mastodon_instances`, `post_groups`, `post_items`), Listen (`feedback_sources`, `raw_feedback`, `feedback_items`), Board/Changelog/Webhooks (`board_items`, `board_votes`, `changelog_entries`, `webhooks`), `usage_logs`, Discovery (`workspace_contexts`, `discovery_communities`, `opportunity_threads`, `response_map`, `voice_configs`).

RLS ist auf allen Tabellen aktiv (`002_rls_policies.sql`), wird aber im Anwendungscode primär durch den Service-Role-Client + manuelles `workspace_id`-Scoping durchgesetzt (s. Invariante 2 oben) — RLS ist Backstop, nicht der einzige Schutz.

**Achtung Migrations-Guardrail**: GOAL-RUN1 verbietet neue Migrationen ohne Rückfrage ("wenn eine Spalte fehlt → Stop und melden"). `002_rls_policies.sql` hat den neuesten Zeitstempel im Repo — falls du daran weiterarbeitest, kläre erst, ob das eine bewusste Ausnahme war oder ob eine Rückfrage nötig gewesen wäre.

## MCP-Server (`apps/mcp-server`)

26 von 27 geplanten Tools sind implementiert, aufgeteilt in `src/tools/publishing.ts` (8/9, `get_usage` fehlt), `listening.ts` (9/9), `discovery.ts` (9/9). `errors.ts` mappt HTTP-Status → deutsche Nutzermeldungen. `index.ts` bricht sofort ab, wenn `PROLORA_API_KEY` fehlt.

## Environment-Variablen (`apps/web/lib/env.ts`, Zod-validiert)

| Variable | Pflicht? | Zweck |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Ja | Supabase-Verbindung |
| `TOKEN_ENCRYPTION_KEY_V2` / `TOKEN_ENCRYPTION_KEY` | Mind. eine | AES-256-GCM, versionierte Key-Rotation |
| `ANTHROPIC_API_KEY` | Ja (`sk-ant-...`) | Claude API — Content-Adaption, Feedback-Analyse, Antwortentwürfe |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Optional | Background-Jobs |
| `REDDIT_CLIENT_ID/SECRET` | Optional | Discovery-Layer |
| `VOYAGE_API_KEY`, `OPENAI_API_KEY` | Optional | Embedding-Provider (fehlen in `.env.example`, akzeptiert `env.ts` trotzdem) |
| `LINKEDIN_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET` | Optional | OAuth-Apps (Bluesky/Telegram/Mastodon brauchen keine globalen Keys) |
| `RESEND_API_KEY` | Optional | E-Mail (Voter-Notifications; Digest-Templates noch nicht gebaut) |
| `OAUTH_STATE_SECRET` | Optional, ≥32 Zeichen | HMAC-Signierung des OAuth-CSRF-State |
| `NEXT_PUBLIC_APP_URL` | Optional | Default `localhost:3000` |

## Befehle

```bash
# aus dem prolora/-Wurzelverzeichnis (npm workspaces)
npm run dev          # startet apps/web (Next.js, Turbopack)
npm run build         # Next.js Build
npm run lint          # next lint
npm run db:migrate    # npx supabase db push
npm run db:reset      # npx supabase db reset
npm run db:types      # generiert packages/shared/database.types.ts (wird aktuell NICHT genutzt, s. lib/db.ts)

# MCP-Server separat:
cd apps/mcp-server && npm run build && npm start
```

## Wichtige Lücken im Tooling — worauf achten

- **Git**: `prolora/` ist versioniert und auf GitHub gespiegelt (privates Repo `yannikgaletto-art/prolora`, verbunden mit Vercel für Auto-Deploys auf `main`). Der übergeordnete Ordner (Architektur-Docs, Knowledge Database) ist weiterhin **nicht** versioniert — sei dort vorsichtig bei destruktiven Dateioperationen.
- **Keine Tests.** Kein `vitest`/`jest`, keine `*.test.ts`-Dateien. Verifikation läuft aktuell nur über `tsc --noEmit` und die "Verhaltens-Oracles" aus den GOAL-RUN-Docs (manuelles/Agent-Durchspielen von Flows). Wenn du testbaren Code hinzufügst, sprich mit dem Nutzer ab, ob ein Test-Setup eingeführt werden soll — es existiert noch keine Konvention dafür.
- **Kein CI.** Keine `.github/workflows`. `tsc --noEmit` in beiden Apps vor Abschluss einer Aufgabe manuell laufen lassen.

## Checkliste, bevor du eine Aufgabe als fertig meldest

1. `tsc --noEmit` in `apps/web` und ggf. `apps/mcp-server` läuft sauber durch.
2. Neue DB-Zugriffe nutzen `getServiceDb()` **mit** explizitem `workspace_id`-Filter, kein `select('*')` auf Tabellen mit PII/Secrets.
3. Neue Route-Handler folgen dem try/catch → `handleRouteError`-Muster.
4. Migrationsänderungen nur nach Rückfrage (siehe GOAL-RUN1-Guardrail oben).
5. Neue Commits enthalten keine Secrets (`.gitignore` prüfen, insbesondere bei neuen Env-/Config-Dateien).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
