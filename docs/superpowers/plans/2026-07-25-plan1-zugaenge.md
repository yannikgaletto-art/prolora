# Plan 1 — Zugänge: Discovery-Provider & Kanal-Betrieb

> **Für 2 Agenten parallel.** Agent **1A (Provider)** und Agent **1B (Kanäle)** arbeiten
> gleichzeitig in getrennten Worktrees. Die Dateibesitz-Tabelle in §3 ist bindend:
> ein Agent editiert **niemals** eine Datei, die dem anderen gehört. Die Verträge in §4
> sind vorab festgelegt, damit beide sofort starten können, ohne aufeinander zu warten.

**Goal:** Nach diesem Plan gibt es in Prolora **keinen einzigen Punkt mehr**, an dem ein
Nutzer aufgefordert wird, eine Env-Variable zu setzen, die er nicht setzen kann — und
Community-Discovery funktioniert für neue Workspaces **ab Sekunde eins ohne jede
Credential-Eingabe**.

**Architecture:** Das für Reddit gebaute Muster (Migration 014: workspace-eigene,
AES-256-GCM-verschlüsselte Credentials mit Live-Verifikation) wird zu zwei generischen
Mechanismen: einem **Discovery-Provider-Registry** (1A) und **BYO-OAuth für Publishing-
Kanäle** (1B). Beide sitzen auf demselben Credential-Store, der als Vertrag vorab fixiert
ist.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres, RLS), Inngest, Zod, vitest,
motion v12. Keine neuen externen Abhängigkeiten.

---

## 1. Warum dieser Plan zuerst kommt

Aus der CEO-Linse, **Leverage-Prüfung**: Mastodon und Hacker News brauchen **gar keine
Credentials** — öffentliche APIs. Das heißt, der teuerste Moment im Produkt (ein neuer
Nutzer steht vor einer leeren Discover-Seite und soll erst eine Reddit-App registrieren)
verschwindet ersatzlos. Das ist der größte Einzelhebel im gesamten Roadmap-Bestand und
kostet am wenigsten.

Aus der Eng-Linse, **Blast Radius**: Dieser Plan ist fast vollständig additiv. Bestehende
Publishing-Pfade werden nicht angefasst. Die einzige Änderung an laufendem Code ist die
Generalisierung von `reddit-credentials.ts`, und die ist durch die Tests von heute
abgesichert.

---

## 2. Systemüberblick

```
                        ┌──────────────────────────────────┐
                        │   workspace_integrations (014)   │
                        │  provider | credentials (AES) |  │
                        │  client_id_hint | verified_at    │
                        └───────────────┬──────────────────┘
                                        │  Vertrag C1 (§4.1)
                        ┌───────────────┴──────────────────┐
                        │  lib/integrations/credentials.ts │
                        │  generisch, provider-agnostisch  │
                        │  BESITZER: Agent 1A              │
                        └───┬──────────────────────────┬───┘
              liest+schreibt│                          │nur lesen
        ╔═══════════════════▼══════════╗   ╔═══════════▼════════════════╗
        ║   AGENT 1A — PROVIDER        ║   ║   AGENT 1B — KANÄLE        ║
        ╠══════════════════════════════╣   ╠════════════════════════════╣
        ║ lib/integrations/registry.ts ║   ║ lib/connections/capacity.ts║
        ║ lib/integrations/providers/  ║   ║ lib/auth/byo-oauth.ts      ║
        ║   reddit.ts                  ║   ║ lib/inngest/functions/     ║
        ║   mastodon.ts   ← 0 Creds    ║   ║   connection-health.ts     ║
        ║   hackernews.ts ← 0 Creds    ║   ║ app/(dashboard)/           ║
        ║   bluesky.ts    ← reuse      ║   ║   connections/*            ║
        ║ lib/discovery/* (Interface)  ║   ║ ConnectChannelPanel.tsx    ║
        ║ ConnectProviderPanel.tsx     ║   ║                            ║
        ║ Migration 015                ║   ║ (keine Migration)          ║
        ╚══════════════════════════════╝   ╚════════════════════════════╝
                        │                          │
                        └──────────┬───────────────┘
                                   ▼
                    Integrations-Task I1 (§7) — ein Agent, am Ende
```

---

## 3. Dateibesitz (bindend)

| Pfad | Besitzer | Anmerkung |
|---|---|---|
| `lib/integrations/credentials.ts` | **1A** | Generalisierung von `reddit-credentials.ts`. 1B **liest nur**. |
| `lib/integrations/registry.ts` | **1A** | neu |
| `lib/integrations/providers/**` | **1A** | neu |
| `lib/discovery/**` | **1A** | Umstellung auf Provider-Interface |
| `app/components/ConnectProviderPanel.tsx` | **1A** | aus `ConnectRedditPanel.tsx` |
| `app/api/v1/integrations/**` | **1A** | generisch statt `/reddit` |
| `supabase/migrations/015_*.sql` | **1A** | enthält **auch** 1Bs Provider-Werte (§4.1) |
| `lib/connections/**` | **1B** | Registry-Erweiterung + `capacity.ts` |
| `lib/auth/byo-oauth.ts` | **1B** | neu |
| `lib/auth/oauth-linkedin.ts`, `oauth-x.ts` | **1B** | Client-ID/Secret-Quelle umstellen |
| `lib/inngest/functions/connection-health.ts` | **1B** | neu |
| `app/(dashboard)/connections/**` | **1B** | |
| `app/components/ConnectChannelPanel.tsx` | **1B** | neu, eigenständig (Begründung §4.3) |
| `lib/system/doctor.ts` | **1B** | 1A meldet gewünschte Änderungen an 1B |

**Kollisionsfreiheit:** Die einzige Datei, die beide brauchen, ist
`lib/integrations/credentials.ts`. Sie gehört 1A und ist durch Vertrag C1 vorab fixiert —
1B kann dagegen programmieren, bevor 1A fertig ist. `lib/system/doctor.ts` ist der zweite
Berührungspunkt und gehört ausschließlich 1B, damit es keine parallelen Edits gibt.

---

## 4. Verträge (vorab fixiert, nicht verhandelbar ohne Absprache)

### 4.1 C1 — Credential-Store

```ts
// lib/integrations/credentials.ts — Besitzer 1A, Konsument 1B
export type IntegrationProvider =
  | 'reddit' | 'mastodon' | 'hackernews' | 'bluesky'   // Discovery (1A)
  | 'linkedin_app' | 'x_app';                          // Publishing-OAuth-Apps (1B)

export type CredentialSource = 'workspace' | 'environment';

export interface StoredCredential { [field: string]: string }

export interface IntegrationStatus {
  provider: IntegrationProvider;
  connected: boolean;
  source: CredentialSource | null;
  clientIdHint: string | null;   // niemals das Secret
  verifiedAt: string | null;
  lastError: string | null;
}

export function resolveCredential(
  workspaceId: string, provider: IntegrationProvider
): Promise<{ credential: StoredCredential; source: CredentialSource } | null>;

export function getIntegrationStatus(
  workspaceId: string, provider: IntegrationProvider
): Promise<IntegrationStatus>;

export function saveCredential(
  workspaceId: string, provider: IntegrationProvider, credential: StoredCredential
): Promise<{ ok: true; status: IntegrationStatus } | { ok: false; reason: string }>;

export function deleteCredential(
  workspaceId: string, provider: IntegrationProvider
): Promise<void>;
```

**Invarianten, die dabei erhalten bleiben müssen** (heute schon so gebaut und getestet):
Auflösungsreihenfolge Workspace vor Env; `getIntegrationStatus` gibt **niemals**
Klartext oder Ciphertext heraus; Speichern verifiziert **vor** dem Schreiben;
`isMissingSchemaError` degradiert Lesepfade statt 500 zu werfen.

**Migration 015** (1A) erweitert den CHECK-Constraint auf **alle sechs** Werte oben —
also auch die von 1B. Ohne das kann 1B nicht schreiben. Das ist die einzige harte
Reihenfolge-Abhängigkeit im ganzen Plan.

### 4.2 C2 — Discovery-Provider-Interface

```ts
// lib/integrations/registry.ts — Besitzer 1A
export interface DiscoveryProvider {
  readonly id: IntegrationProvider;
  readonly capabilities: {
    findCommunities: boolean;
    readRules: boolean;      // Hacker News: false
    scanThreads: boolean;
  };
  searchCommunities(topics: string[], limit: number): Promise<DiscoveredCommunityCandidate[]>;
  getCommunityRules(externalId: string): Promise<CommunityRule[] | null>;  // null = nicht unterstützt
  searchThreads(externalId: string, query: string, opts: ThreadSearchOptions): Promise<DiscoveredThread[]>;
  getHotThreads(externalId: string, limit: number): Promise<DiscoveredThread[]>;
}
```

**Regel:** Ein Provider ohne `readRules` gibt `null` zurück und wirft **nicht**.
`community-mapper.ts` behandelt `null` als „Regeln nicht verfügbar" und überspringt den
Regel-Teil der LLM-Bewertung, statt die ganze Zuordnung fallen zu lassen.

### 4.3 Warum zwei Connect-Panels statt einem

`ConnectProviderPanel` (1A) behandelt **Paste-Credentials**: Nutzer kopiert Key/Secret,
wir verifizieren synchron, fertig. `ConnectChannelPanel` (1B) behandelt **BYO-OAuth**:
Nutzer hinterlegt App-Credentials, *danach* folgt ein Redirect-Tanz mit State-HMAC,
Callback und Token-Speicherung in `platform_connections`. Das sind zwei verschiedene
Zustandsmaschinen. Sie in eine Komponente zu zwingen wäre die Art von voreiliger
Abstraktion, die später jeder bereut. Geteilt wird die *visuelle* Sprache (Schritt-Liste,
Copy-Feld, Verifikations-Status), nicht die Logik.

---

## 5. Agent 1A — Provider

**Auftrag:** Discovery funktioniert auf vier Plattformen, zwei davon ohne jede Eingabe.

### 1A.1 Credential-Store generalisieren
`reddit-credentials.ts` → `credentials.ts` nach Vertrag C1. Provider-spezifisches
(Verifikation, Feldnamen) wandert in `providers/<id>.ts`. Bestehende Tests
(`test/reddit-credentials.test.ts`) müssen grün bleiben — sie sind der Regressionsschutz
für die Invarianten. Migration 015 schreiben, **nicht anwenden** (STOP-Gate, §9).

### 1A.2 Registry + Provider-Deskriptoren
`DiscoveryProviderDescriptor` beschreibt deklarativ: `credentialKind`
(`none` | `api_key` | `reuse_connection`), Feld-Deskriptoren, Setup-Schritte, Deep-Link.
Die heute in `ConnectRedditPanel` **hartkodierte** 3-Schritt-Anleitung wird datengetrieben.
Ergebnis: neuer Provider = ein Registry-Eintrag + ein Client-Modul, **keine neue UI**.

### 1A.3 Mastodon-Provider (`credentialKind: 'none'`)
Öffentliche Instanz-API: `/api/v2/search` für Hashtags/Accounts, Hashtag-Timelines für
Threads. Instanz-Auswahl (Default: mehrere große DACH-/Tech-Instanzen parallel abfragen).
Keine Regeln-API → `getCommunityRules` gibt `null`.

### 1A.4 Hacker News-Provider (`credentialKind: 'none'`)
Algolia-API (`hn.algolia.com/api/v1`), frei, kein Key. „Communities" gibt es dort nicht —
der Provider bildet **Themen-Queries** als Pseudo-Communities ab (`capabilities.findCommunities: false`,
`scanThreads: true`). Ehrlich in der UI kennzeichnen: „Hacker News hat keine Communities,
nur Themen."

### 1A.5 Bluesky-Provider (`credentialKind: 'reuse_connection'`)
Nutzt das **bestehende** App-Password aus `platform_connections` — keine zweite
Credential-Eingabe. Wenn keine Bluesky-Connection existiert: Status
`connected: false, reason: 'connect_bluesky_first'` mit Deep-Link auf den Connections-Tab.

### 1A.6 Discovery-Kern auf Provider umstellen
`community-mapper.ts`, `thread-radar.ts`, `reddit-listener.ts` sprechen nur noch gegen
`DiscoveryProvider`. `discovery_communities.platform` wird echt mehrwertig;
`community_external_id` ergänzen (Migration 015) für stabile Dedupe über Provider hinweg.

### 1A.7 UI generalisieren
`ConnectRedditPanel` → `ConnectProviderPanel`, gerendert aus dem Deskriptor. Discover-Seite
zeigt eine Provider-Auswahl; die zwei credential-freien Provider stehen oben und sind
sofort nutzbar.

---

## 6. Agent 1B — Kanäle

**Auftrag:** Kanäle sind selbst einrichtbar und ihr Betriebszustand ist sichtbar, bevor
etwas kaputtgeht.

### 1B.1 BYO-OAuth für LinkedIn und X
Heute steht im Connector-Registry *„Operator OAuth setup required"* — dieselbe Sackgasse,
die für Reddit beseitigt wurde. Neu: `connectFlow: 'oauth_byo'`. Der Nutzer hinterlegt
Client-ID/Secret seiner eigenen LinkedIn-/X-App (verschlüsselt über C1, Provider
`linkedin_app` / `x_app`), dann läuft der normale OAuth-Redirect gegen **seine** App.
`oauth-linkedin.ts` / `oauth-x.ts` beziehen Client-ID/Secret künftig aus
`resolveCredential(workspaceId, 'linkedin_app')` statt direkt aus `process.env` —
Env bleibt Fallback.

**Sicherheitsdetail, nicht optional:** Die Redirect-URI muss weiterhin gegen die eigene
`NEXT_PUBLIC_APP_URL` geprüft werden. Ein Nutzer, der eine fremde App-ID hinterlegt, darf
den State-HMAC-Schutz (`OAUTH_STATE_SECRET`) nicht umgehen können.

### 1B.2 Token-Health-Monitor
Inngest-Job, täglich. Stuft jede Connection ein: `healthy` / `expiring_soon` (< 7 Tage) /
`expired` / `revoked`, schreibt nach `platform_connections.last_health_check`, emittiert
`connection/health-changed`. Der Advisory-Lock-Refresh aus FABLE-01 wird **nicht**
angefasst — der Monitor liest nur und stößt bei Bedarf den bestehenden Refresh an.

### 1B.3 Kanal-Kapazität
`lib/connections/capacity.ts` beantwortet: „Wie viele Posts darf dieser Kanal heute noch?"
Quelle: `rate_limit_state` (existiert als Spalte, wird bislang nicht als Planungsgröße
genutzt) + plattformspezifische Tageslimits. **Wird von Plan 2 konsumiert** — deshalb ist
die Signatur Teil des Vertrags:

```ts
// lib/connections/capacity.ts — Besitzer 1B, Konsument: Plan 2 / Agent 2B
export interface ChannelCapacity {
  connectionId: string;
  platform: string;
  remainingToday: number | null;   // null = unbegrenzt
  nextResetAt: string | null;
  blocked: boolean;
  blockedReason: 'rate_limited' | 'token_expired' | 'revoked' | null;
}
export function getChannelCapacity(workspaceId: string): Promise<ChannelCapacity[]>;
```

### 1B.4 Connections-UI
Ampel pro Karte, Vorwarnung („Token läuft in 5 Tagen ab") mit Ein-Klick-Reconnect,
Kapazitäts-Übersicht („Heute noch möglich: LinkedIn 3, X 12, Bluesky ∞"). Die vier
Kategorien des Registrys (`available` / `oauth_byo` / `manual_assist` / `coming_soon`)
werden optisch getrennt — heute wirft die UI sie in einen Topf.

### 1B.5 Doctor aufräumen
`lib/system/doctor.ts`: `connect_linkedin` / `connect_x` werden `selfServiceable: true`
und workspace-abhängig (analog zur heutigen Reddit-Behandlung). Danach zeigt der
System-Status keine Env-Variablennamen mehr für Dinge, die der Nutzer selbst lösen kann.

---

## 7. Integrations-Task I1 (ein Agent, nach beiden Strängen)

1. Migration 015 anwenden (STOP-Gate, §9) und beide Stränge dagegen laufen lassen.
2. `tsc --noEmit` in `apps/web` und `apps/mcp-server`.
3. `npx vitest run` — vollständig grün, inkl. der heutigen Reddit-Tests.
4. `npm run build`.
5. Ein Durchlauf pro Provider: Discover → Community finden → Thread-Scan.
6. Ein BYO-OAuth-Durchlauf für LinkedIn **oder** X (je nachdem, wo eine App vorliegt).

---

## 8. Failure Modes (Eng-Linse: benannt, nicht „error handling")

| Codepfad | Realistischer Produktionsfehler | Abgedeckt durch |
|---|---|---|
| Mastodon-Instanz offline | `fetch` Timeout → gesamter Discovery-Lauf schlägt fehl | Pro Instanz `try/catch`, Teilergebnis zurückgeben, Instanz als degradiert markieren |
| HN-Algolia Rate-Limit | HTTP 429 mitten im Scan | Backoff + Teilergebnis; Listener wirft nie (bestehende Invariante) |
| Bluesky-Connection gelöscht, Discovery-Provider bleibt aktiv | `reuse_connection` löst ins Leere auf | `resolveCredential` gibt `null`, Provider meldet `connect_bluesky_first`, kein 500 |
| Nutzer hinterlegt LinkedIn-App mit falscher Redirect-URI | OAuth-Callback schlägt beim Provider fehl, Nutzer landet auf Fehlerseite | Redirect-URI im Panel zum Kopieren + Vorabprüfung gegen `NEXT_PUBLIC_APP_URL` |
| Migration 015 nicht angewendet, Code deployed | Schreiben auf neue Provider-Werte verletzt CHECK | `isMissingSchemaError`-Muster erweitern: CHECK-Verletzung → 503 `migration_pending` |
| `TOKEN_ENCRYPTION_KEY_V2` rotiert ohne Neueingabe | Entschlüsselung schlägt fehl | Bereits gelöst: Fallback auf Env + Server-Log, kein Absturz |
| Zwei Workspaces, gleicher Provider | Token-Cache-Verwechslung | Bereits gelöst: Cache pro `client_id` gekeyed |

---

## 9. Migrations-STOP-Gate

Migration 015 wird von 1A **geschrieben, aber nicht angewendet**. Der Agent legt die Datei
an, meldet sich beim Nutzer und wartet. Anwenden erfolgt nach Bestätigung — entweder per
SQL-Editor oder `npm run db:migrate`. (Grund: CLAUDE.md-Guardrail; zusätzlich hat die
Supabase-CLI in diesem Repo keinen Projekt-Link.)

---

## 10. Testanforderungen

Neue Testdateien in `apps/web/test/`, Stil an `reddit-credentials.test.ts` orientiert
(externe Ränder per `vi.mock`, keine echte DB):

| Datei | Deckt ab |
|---|---|
| `integration-credentials.test.ts` (1A) | Auflösungsreihenfolge, kein Secret-Leak, Schema-Drift-Degradation, Verify-vor-Speichern — für **alle** Provider-Werte |
| `provider-registry.test.ts` (1A) | Deskriptor→Formular-Ableitung; `readRules: false` liefert `null` statt Wurf |
| `provider-mastodon.test.ts` (1A) | Instanz-Ausfall degradiert zu Teilergebnis |
| `provider-hackernews.test.ts` (1A) | Themen-als-Pseudo-Community-Abbildung |
| `byo-oauth.test.ts` (1B) | Client-ID aus Workspace vor Env; Redirect-URI-Prüfung; State-HMAC bleibt intakt |
| `connection-health.test.ts` (1B) | Vier Zustandsübergänge; abgelaufenes Token blockiert Kapazität |
| `channel-capacity.test.ts` (1B) | `remainingToday`-Berechnung; `null` = unbegrenzt |

---

## 11. NOT in scope (bewusst gestrichen)

| Gestrichen | Warum |
|---|---|
| **YouTube-, Product-Hunt-, X-Discovery-Provider** | Erst nach Beweis, dass die generische Provider-Schicht trägt. Drei Provider reichen als Beleg. |
| **LinkedIn-Community-Discovery** | Groups-API ist seit Jahren stillgelegt. Nicht baubar — ehrlich kommunizieren statt in der Roadmap führen. |
| **Discord-Server-Discovery** | Keine öffentliche Server-Discovery-API. |
| **Instagram/TikTok/YouTube-Posting** | Hängt an App-Review-Prozessen der Anbieter, nicht an Code. Externe Abhängigkeit, kein Task. |
| **Kanal-Profil pro Account** (Tonalität, Tabus, gelernte Zeiten) | Gehört inhaltlich zu Plan 2 (kanal-native Erzeugung). Hier wäre es verfrüht. |
| **Multi-Account-Verwaltung pro Plattform** | `account_type` existiert; echte Mehrfach-Accounts sind ein eigener Plan. |

---

## 12. Was bereits existiert (nicht neu bauen)

| Vorhanden | Umgang |
|---|---|
| `workspace_integrations` + AES-256-GCM + Verify-vor-Speichern (Mig. 014, heute gebaut) | **Wird generalisiert**, nicht ersetzt. Tests bleiben als Regressionsschutz. |
| `lib/connections/registry.ts` mit 21 Kanälen inkl. `manual_assist` | **Wird erweitert** um `oauth_byo`, nicht neu geschrieben. |
| `lib/auth/oauth-state.ts` (HMAC-CSRF), `token-manager.ts` (Advisory-Lock-Refresh) | **Unangetastet.** 1B ändert nur die Herkunft von Client-ID/Secret. |
| `platform_connections.rate_limit_state`, `last_health_check`, `refresh_locked_until` | Spalten existieren — 1B **nutzt** sie, statt neue anzulegen. |
| `isMissingSchemaError` (lib/db.ts) | Muster für Deploy-Reihenfolge — wiederverwenden. |
| `RedditClient` mit Token-Cache pro `client_id` | Vorlage für alle weiteren Provider-Clients. |
