# Prolora — Next-Level-Architektur: Discovery, Connections, Listen, Publish

> ⚠️ **ABGELÖST am 2026-07-25 — nicht direkt bauen.** Dieses Dokument bleibt als
> Analyse- und Begründungsgrundlage bestehen (CEO-Bewertung §1, blockierende Wahrheiten §2,
> Provider-Matrix §3.2). Die **ausführbaren** Pläne sind:
> - [Plan 1 — Zugänge](2026-07-25-plan1-zugaenge.md) (Agenten 1A + 1B)
> - [Plan 2 — Content-Fabrik](2026-07-25-plan2-content-fabrik.md) (Agenten 2A + 2B)
>
> Änderungen gegenüber diesem Dokument: **Video-Erzeugung gestrichen** (D.4.3, Nutzer-
> Entscheidung); Scope gekürzt nach ausgelöstem Step-0-Komplexitätscheck des Eng-Reviews
> (gestrichen: YouTube/PH/X-Provider, Kanal-Profil, Wochen-Briefing, Lernspeicher,
> plattform-native Sonderformate — siehe „NOT in scope" in beiden Plänen).

> **Für agentische Worker:** Dies ist ein **Architektur-Plan**, bewusst ohne fertigen Code (Nutzer-Vorgabe: „du baust nur die Softwarearchitektur"). Jeder Workstream ist so geschnitten, dass daraus ein eigener, code-vollständiger Plan nach `writing-plans` abgeleitet werden kann. Reihenfolge und Abhängigkeiten stehen in §9.

**Goal:** Prolora von vier nebeneinanderstehenden Reitern zu **einer geschlossenen Content-Maschine** machen, die 2–3 belegbare Value-Posts pro Tag über alle Kanäle produziert — und Community-Discovery von „nur Reddit" auf alle Plattformen erweitern, die überhaupt eine haben.

**Architecture:** Drei Schichten, die heute existieren, aber nicht verbunden sind, werden zu einem Kreislauf verdrahtet: **Listen** (was der Markt sagt) → **Discover** (wo er es sagt) → **Proof** (was wir ehrlich behaupten dürfen) → **Publish** (plattform-nativ, mehrvariantig, mit Qualitäts-Gate) → **Measure** (Prognose vs. Realität) → zurück in Listen. Technisch trägt das ein neuer **Content-Supply-Chain-Layer** (`lib/pipeline/`), ein generalisiertes **Provider-Registry** für Discovery-Zugänge (Verallgemeinerung von Migration 014) und ein **blockierendes Quality-Gate** vor dem Publish.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + pgvector + RLS), Inngest, Anthropic Claude, OpenAI (gpt-image-2 / sora-2), motion v12, Zod, vitest.

---

## 1. CEO-Blick: Wo der Moat wirklich liegt

**Was du nicht bist:** ein besseres Buffer. Cross-Posting ist seit Jahren Commodity — Buffer, Publer, Metricool, Hootsuite machen es ab 6 €/Monat. Jede Roadmap, deren Kern „auf mehr Plattformen posten" ist, führt in einen Preiskampf, den du nicht gewinnst.

**Was du schon hast und praktisch niemand sonst:**

| Asset im Code | Warum das ein Moat ist |
|---|---|
| `proof_assets` (Mig. 012) + Anti-Fabrication-Anker | Jedes andere KI-Posting-Tool halluziniert Zahlen. Prolora kann Behauptungen an belegte Assets binden. Das ist Vertrauens-Infrastruktur, kein Feature. |
| Resonanz-Schema (`content_references.structure`) | `beweisbarer_ausgangspunkt → bruch → unerwarteter_befund → mechanismus → handlungsregel → reibungsfrage` — ein **strukturelles** Content-Modell statt „schreib mir einen Post". Extrem schwer zu kopieren, weil es Redaktions-Know-how ist, kein Prompt. |
| `lib/scoring/` — Prognose + `reconcile.ts` gegen echte Metriken, median/MAD-Baselines | Geschlossene Feedback-Schleife auf Post-Ebene. Taplio/Hypefury raten; Prolora kalibriert. |
| Listen + Discover + Publish in **einem** Datenmodell | Canny weiß, was Nutzer wollen, kann aber nicht posten. Buffer postet, weiß aber nichts. Du hast beide Hälften. |
| Ehrlichkeits-Invarianten (kein Auto-Posting auf Reddit, „unverifiziert" statt erfundener Engagement-Zahlen) | In einem Markt, der gerade in KI-Spam ertrinkt, ist erzwungene Ehrlichkeit ein Verkaufsargument — besonders im DACH/DSGVO-Segment. |

**Die eine strategische Aussage:** Der Moat ist **die Schleife, nicht die Reiter**. Heute sind Listen, Discover und Publish drei Navigationspunkte, zwischen denen der Nutzer selbst Schlüsse ziehen muss. Kein Wettbewerber kann die Schleife nachbauen, ohne beide Produkthälften zu besitzen — aber solange sie nur nebeneinanderstehen, merkt kein Kunde, dass sie da ist. **Die gesamte Roadmap unten dient dem Ziel, die Schleife sichtbar und automatisch zu machen.**

**Die Positionierung, die daraus folgt:** Nicht „Publishing-Tool mit Feedback-Feature", sondern:

> *Prolora schreibt nur Posts, die es belegen kann — aus dem, was deine Nutzer letzte Woche wirklich gesagt haben.*

---

## 2. Drei blockierende Wahrheiten (vor jeder Roadmap zu klären)

Diese drei Punkte machen das erklärte Ziel „2–3 hochwertige Value-Posts pro Tag" mit dem heutigen Code **rechnerisch unmöglich**. Sie gehören zuerst entschieden, nicht ans Ende.

### 2.1 Das Media-Budget kollidiert hart mit der Post-Frequenz

`lib/media/generation.ts` erzwingt **10 € pro Workspace und Kalendermonat** (`MEDIA_BUDGET_LIMIT_EUR`), bei `image = 0,12 €` und `video = 1,50 €` (sora-2, 8 s).

Rechnung für 2,5 Posts/Tag = **75 Posts/Monat**:

| Szenario | Kosten/Monat | Passt in 10 €? |
|---|---|---|
| 75 Posts, je 1 Bild | 9,00 € | Gerade so — kein Puffer, keine Verwerfungen |
| 75 Posts, je 1 Bild + 2 Verwerfungen pro Post (realistisch für Qualität) | 27,00 € | **Nein** |
| 1 Video pro Tag (30 Videos) | 45,00 € | **Nein, um Faktor 4,5** |
| „Weltmeister"-Niveau: 75 Bilder mit Auswahl + 20 Videos | ~57 € | **Nein, um Faktor 5,7** |

**Entscheidung nötig:** Budget auf realistische Größenordnung heben (Vorschlag: plan-abhängig, Starter 10 € / Pro 60 € / Agency 200 €) **und** die Verwerfungs-Kosten explizit einplanen — Qualität entsteht durch Auswahl, und Auswahl kostet Generierungen. Ohne diese Entscheidung ist Workstream D.4 (Visual System) nicht baubar. Das Budget-Ledger (`media_budget_ledger`, atomare RPC-Reservierung) ist gut gebaut und bleibt — nur die Zahl ist zu klein.

### 2.2 „Alle Plattformen" gibt es nicht — drei Kanäle sind technisch tot

Ehrliche Bestandsaufnahme statt Roadmap-Lyrik:

- **LinkedIn Groups:** Die Groups-API ist seit Jahren stillgelegt. Community-Discovery auf LinkedIn ist **nicht baubar**. Was geht: Personen-/Hashtag-basierte Zielgruppen-Signale, keine Communities.
- **Instagram / TikTok / YouTube-Posting:** stehen auf `coming_soon` und hängen an **App-Review-Prozessen der Anbieter**, nicht an deinem Code. Das ist Kalenderzeit (Wochen bis Monate), kein Sprint. Sollte in der Planung als externe Abhängigkeit geführt werden, nicht als Task.
- **X-API:** Suche/Discovery ist kostenpflichtig und teuer. Machbar nur nach dem Self-Service-Muster (Nutzer bringt eigenen Key), niemals aus deinem Betreiber-Kontingent.

### 2.3 Der Impact Coach berät, blockiert aber nicht

`lib/scoring/deterministic.ts` liefert Punkte und Hinweise — der Nutzer kann trotzdem jeden Post veröffentlichen. Bei 3 Posts/Tag × 8 Kanälen entstehen **~720 Veröffentlichungen/Monat**. Ohne ein *blockierendes* Gate skaliert bei dieser Frequenz nicht die Qualität, sondern der Reputationsschaden. Weltmeister-Niveau heißt: **das System muss Nein sagen dürfen.** Siehe D.3.

---

## 3. Workstream A — Discovery-Provider generalisieren

**Ziel:** Das für Reddit gebaute Self-Service-Muster (Migration 014) wird zum generischen Mechanismus für jede Plattform mit auffindbaren Communities.

### A.1 Das Muster verallgemeinern

Heute ist `workspace_integrations.provider` per CHECK-Constraint auf `'reddit'` festgenagelt, und `lib/integrations/reddit-credentials.ts` ist reddit-spezifisch. Beides wird generisch:

**Neue Struktur:**
```
lib/integrations/
  registry.ts            ← NEU: DiscoveryProviderDescriptor[], Parallele zu lib/connections/registry.ts
  credentials.ts         ← NEU: generisch (get/save/delete/verify) über provider-Key
  providers/
    reddit.ts            ← Umbau des heutigen reddit-credentials.ts
    mastodon.ts          ← NEU
    bluesky.ts           ← NEU
    hackernews.ts        ← NEU
    stackexchange.ts     ← NEU
    youtube.ts           ← NEU
    x.ts                 ← NEU
    producthunt.ts       ← NEU
```

`DiscoveryProviderDescriptor` beschreibt pro Provider deklarativ: `id`, `label`, `credentialKind` (`none` | `api_key` | `oauth_app` | `reuse_connection`), Feld-Deskriptoren fürs Formular, Setup-Schritte (die 3-Schritt-Anleitung wird datengetrieben statt hartkodiert), Deep-Link, und `capabilities` (`find_communities`, `scan_threads`, `read_rules`).

Die `ConnectRedditPanel.tsx` wird zu **`ConnectProviderPanel.tsx`** — rendert das Formular aus dem Deskriptor. Ein neuer Provider = ein Registry-Eintrag + ein Client-Modul, **keine neue UI**.

### A.2 Realistische Provider-Matrix

| Provider | Zugang | Aufwand | Wert | Priorität |
|---|---|---|---|---|
| **Mastodon** | **keine Credentials** — öffentliche Instanz-API (`/api/v2/search`, Hashtag-Timelines) | S | Hoch: DACH-Tech-Publikum, null Setup-Reibung | **1** |
| **Hacker News** | **keine Credentials** — Algolia-API, frei | S | Hoch für B2B-SaaS/Founder-Zielgruppe | **1** |
| **Bluesky** | Wiederverwendung der **bestehenden** Connection (App-Password liegt schon in `platform_connections`) — `credentialKind: reuse_connection` | S | Mittel-hoch, wachsend | **2** |
| **Stack Exchange** | API-Key, frei | M | Hoch bei Entwickler-Zielgruppe | **2** |
| **YouTube** | Data API v3 Key (Self-Service) | M | Mittel: Kommentar-/Community-Signale | **3** |
| **Product Hunt** | GraphQL-Token (Self-Service) | M | Mittel, launch-getrieben | **3** |
| **X** | Bezahlter Key (Self-Service, nie Betreiber-Kontingent) | M | Mittel, teuer | **4** |
| **Discord** | keine Server-Discovery-API — nur manuell kuratiert | — | Niedrig | **Nicht bauen** |
| **LinkedIn** | Groups-API tot | — | — | **Nicht bauen, ehrlich kommunizieren** |

Der Ansatz zahlt sich sofort aus: **Mastodon und Hacker News brauchen gar keine Credentials.** Das heißt, Community-Discovery funktioniert für neue Nutzer ab Sekunde eins, ohne die Reddit-Hürde. Das ist der beste Onboarding-Hebel im ganzen Plan.

### A.3 Datenmodell

- **Migration 015:** `workspace_integrations.provider` CHECK-Constraint auf die Provider-Liste erweitern; `scopes JSONB` ergänzen.
- `discovery_communities.platform` (heute faktisch immer `'reddit'`) wird echt mehrwertig; `community_external_id` ergänzen für stabile Dedupe über Provider hinweg.
- **Provider-Fähigkeiten sind Daten, keine ifs:** `thread-radar.ts` und `community-mapper.ts` sprechen nur noch gegen ein `DiscoveryProvider`-Interface (`searchCommunities`, `getCommunityRules`, `searchThreads`, `getHotThreads`). Provider ohne `read_rules` (z. B. Hacker News) liefern `null` statt zu werfen — die UI zeigt „Regeln nicht verfügbar", nicht einen leeren Kasten.

### A.4 Das gleiche Muster für Connections (direkte Antwort auf deine Frage)

LinkedIn und X stehen im Connector-Registry auf `setup_required` mit dem Text *„Operator OAuth setup required"* — **exakt dieselbe Sackgasse, die ich für Reddit beseitigt habe.** Sie bekommen dieselbe Behandlung: `connectFlow: 'oauth_byo'` (bring your own app), geführtes Setup mit Deep-Link zum jeweiligen Developer-Portal, Redirect-URI zum Kopieren, Client-ID/Secret verschlüsselt in `workspace_integrations`, Live-Verifikation vor dem Speichern. Danach gibt es in der ganzen App **keinen einzigen Punkt mehr**, an dem der Nutzer aufgefordert wird, eine Env-Variable zu setzen, die er nicht setzen kann.

---

## 4. Workstream B — Connections

**Diagnose:** Der Reiter ist ein *Zustandsanzeiger*. Für Weltmeister-Frequenz muss er ein *Betriebssystem für Kanäle* werden. Bei ~720 Veröffentlichungen/Monat ist ein stillschweigend abgelaufenes Token kein Schönheitsfehler, sondern ein Tagesausfall.

### Backend
- **B.1 Token-Health-Monitor** (Inngest, täglich): `platform_connections.last_health_check` wird heute geschrieben, aber niemand prüft proaktiv. Neuer Job stuft je Connection in `healthy` / `expiring_soon` (< 7 Tage) / `expired` / `revoked` ein und emittiert `connection/health-changed`. Der Refresh-Advisory-Lock aus FABLE-01 bleibt unangetastet.
- **B.2 Rate-Limit-Budget pro Kanal:** `rate_limit_state` existiert als Spalte, wird aber nicht als Planungsgröße genutzt. Neu: `lib/connections/capacity.ts` beantwortet „wie viele Posts darf dieser Kanal heute noch?" — der Scheduler (D.5) fragt das **vor** dem Einplanen, statt beim Publizieren auf 429 zu laufen.
- **B.3 Kanal-Profil statt nur Credential:** pro Connection Zielgruppe, Tonalität, Tabus, beste Posting-Zeiten (aus `post_metrics` gelernt). Speisen `adapt-content.ts` — heute adaptiert es nur nach *Plattform*, nicht nach *Account*. Zwei LinkedIn-Accounts (Firma vs. Founder) brauchen unterschiedliche Stimmen.

### Frontend
- **B.4 Ampel + Vorwarnung:** Health-Status pro Karte, „Token läuft in 5 Tagen ab" mit Ein-Klick-Reconnect. Aktuell erfährt der Nutzer vom Ablauf erst durch einen fehlgeschlagenen Post.
- **B.5 Kapazitäts-Übersicht:** „Heute noch möglich: LinkedIn 3, X 12, Bluesky ∞" — macht die Frequenz-Planung physisch begreifbar.
- **B.6 Ehrliche Trennung** von `available` / `bring your own app` / `manual assist` / `blockiert durch Anbieter-Review`. Die vier Kategorien existieren im Registry, die UI wirft sie optisch in einen Topf.

---

## 5. Workstream C — Listen

> ⚠️ **Koordination:** An den Listen-UI-Dateien (`SourceRail.tsx`, `FeedbackRow.tsx`, `source-meta.tsx`, `FeedbackFilterBar.tsx`) hat am 2026-07-25 parallel eine andere Session gearbeitet; die Änderungen waren zum Zeitpunkt dieses Plans noch uncommitted. **Vor Beginn von C den Stand dieser Arbeit abgleichen.** Die Backend-Punkte C.1–C.3 sind davon unberührt.

**Diagnose:** Listen ist heute ein *Posteingang*. Für die Schleife muss es eine *Themen-Maschine* werden. Einzelne Feedback-Items sind für Content wertlos; **wiederkehrende Muster** sind Gold.

### Backend
- **C.1 Theme-Clustering über Zeit** (`lib/feedback/themes.ts`): Die pgvector-Embeddings werden heute nur für Dedupe genutzt. Dieselben Vektoren clustern zu persistenten *Themen* (`feedback_themes`, Migration 016) mit Verlauf über Wochen. Liefert: „Onboarding-Verwirrung: 23 Nennungen, +40 % ggü. Vormonat."
- **C.2 Signal-Erkennung:** Nicht nur „was ist häufig", sondern „was ist **neu** oder **beschleunigt**". Ein Thema, das von 2 auf 14 Nennungen springt, ist der beste Post-Anlass, den es gibt — und der zeitkritischste.
- **C.3 Automatische Proof-Extraktion:** Erkennt in eingehendem Feedback belegbare Aussagen (konkretes Zitat, messbares Ergebnis) und schlägt sie als `proof_asset` vor — mit Quelle und Zustimmungs-Status. **Das ist die Nahtstelle, an der Listen den Publish-Layer füttert**, und der wichtigste einzelne Baustein der ganzen Schleife.

### Frontend
- **C.4 Themen-Ansicht** als primäre Sicht (Item-Liste wird Drill-down): Themen nach Momentum sortiert, mit Sparkline.
- **C.5 „Daraus einen Post machen"** direkt an jedem Thema — übergibt Thema + zugehörige Proof-Assets an die Publish-Pipeline. Das ist die sichtbar gemachte Schleife.

---

## 6. Workstream D — Publish (Kern)

**Diagnose:** Der Composer ist ein hervorragendes **Einzelstück-Werkzeug**. „2–3 Value-Posts pro Tag auf allen Plattformen" ist aber kein Schreib-, sondern ein **Lieferketten-Problem**. Niemand schreibt 75 Posts × 8 Varianten von Hand. Es fehlt nicht ein besserer Editor, sondern eine Fabrik mit Qualitätskontrolle.

### D.1 Content-Supply-Chain als eigener Layer — `lib/pipeline/`

Neue Kern-Abstraktion: **Content-Item mit Zustandsmaschine**, statt „Post = Draft oder Published".

```
signal        → aus Listen-Thema, Proof-Asset, Discovery-Thread, manueller Idee
  ↓
angle         → Blickwinkel (lib/content/angle-service.ts existiert bereits)
  ↓
concept       → Resonanz-Struktur gefüllt (lib/content/concept-service.ts existiert)
  ↓
draft_set     → N Varianten, nicht eine
  ↓
quality_gate  → blockierend (D.3)
  ↓
scheduled     → Slot-Allokation (lib/posts/slot-allocator.ts existiert)
  ↓
published     → pro Kanal
  ↓
measured      → lib/scoring/reconcile.ts existiert
  ↓
  └─→ zurück als Signal (was funktioniert hat, wird Vorlage)
```

**Wichtig:** Fast alle Bausteine existieren schon — `angle-service`, `concept-service`, `splinter`, `slot-allocator`, `reconcile`, `reference-matcher`. Sie sind nur nicht als **eine durchgehende Kette** modelliert. `lib/pipeline/` ist primär ein *Orchestrator* über vorhandene Teile, kein Neubau. Das ist der günstigste große Hebel im gesamten Plan.

- **Migration 017:** `content_items` (Zustand, Signal-Herkunft, Angle, Concept, Qualitäts-Score, geplante Kanäle) + `content_item_variants`.

### D.2 Ideen-Nachschub, der nie versiegt — `lib/pipeline/inventory.ts`

Bei 75 Posts/Monat ist das Themen-Reservoir der echte Engpass, nicht die Textproduktion. Quellen, automatisch und kontinuierlich:
1. Listen-Themen mit Momentum (C.2)
2. Discovery-Threads: wiederkehrende Fragen in gemappten Communities (`top_recurring_questions` wird bereits erhoben — heute nirgends genutzt)
3. Proof-Assets ohne Post-Historie („dieses Ergebnis hast du nie erzählt")
4. Splinter aus Longform (`lib/content/splinter.ts` existiert)
5. Reconcile-Gewinner: Was überdurchschnittlich lief, verdient eine Fortsetzung

**Frontend:** Ein **Content-Inventory-Board** mit Ampel „Reichweite für 12 Tage geplant" — der Nutzer sieht, wann ihm die Themen ausgehen, *bevor* es passiert.

### D.3 Blockierendes Quality-Gate — `lib/pipeline/quality-gate.ts`

Der entscheidende Baustein für „Weltmeister". Vier Prüfungen, in dieser Reihenfolge, **Abbruch bei Nichtbestehen**:

1. **Proof-Bindung (hart):** Jede überprüfbare Behauptung (Zahl, Ergebnis, Vergleich) muss auf ein `proof_asset` zeigen. Unbelegte Zahl → Post wird blockiert, nicht kommentiert. Das ist die Durchsetzung der Anti-Fabrication-Invariante, die im Datenmodell schon angelegt ist.
2. **Strukturprüfung:** Erfüllt der Entwurf das Resonanz-Schema? Fehlender `unerwarteter_befund` = generischer Post = blockiert.
3. **Deterministische Prüfung:** `lib/scoring/deterministic.ts` (existiert) mit Schwelle statt nur Punktzahl.
4. **Selbstähnlichkeits-Check:** Embedding-Vergleich gegen die letzten 90 Tage. Zu ähnlich zu einem eigenen Post → blockiert. Verhindert die Wiederholungsschleife, in der jedes hochfrequente KI-Konto endet.

**Frontend:** Gate-Ergebnis als Diagnose mit konkretem nächstem Schritt, nicht als Note. Bei „unbelegte Behauptung" direkt der Knopf „Proof hinzufügen".

### D.4 Visual System — von Einzelbildern zu Markenkonsistenz

Heute: `generation.ts` erzeugt Einzelbilder pro Post. Bei 75 Posts entsteht dabei visueller Wildwuchs — jedes Bild sieht anders aus, die Marke verschwindet.

- **D.4.1 Brand-Visual-Profile** (Migration 018): Palette, Typo, Bildsprache, Logo-Platzierung als Workspace-Asset. Fließt in **jeden** Generierungs-Prompt.
- **D.4.2 Visual-Templates statt Freitext-Prompts:** Zitat-Karte, Datenpunkt-Karte, Vorher-Nachher, Framework-Diagramm, Screenshot-Rahmen. Deterministisches Layout (SVG/Satori serverseitig gerendert) + generiertes Bild nur dort, wo es wirklich Bild sein muss. **Spart massiv Budget** und ist konsistenter als jede Generierung — direkte Antwort auf §2.1.
- **D.4.3 Video-Kompositionsschicht:** Ein 8-s-Sora-Clip ist kein Value-Post. Nötig ist Komposition: Screen-Recording + Untertitel + B-Roll + Marken-Outro. Architektur: Remotion-artiges serverseitiges Rendering, generierte Clips als *Zutat*, nicht als Endprodukt. **Größter Einzelposten des Plans — eigener Spike vor Zusage.**
- **D.4.4 Plattform-native Formate:** LinkedIn-Karussell (PDF), X-Thread als Einheit, YouTube-Shorts-Vertikalschnitt. `post_items.payload` trägt das bereits (Mig. 005).

### D.5 Frequenz-Motor

- **D.5.1 Content-Mix-Regeln:** Zielverteilung pro Woche (z. B. 40 % Insight, 30 % Proof/Case, 20 % Story, 10 % Frage). Der Scheduler wählt aus dem Inventory **nach Mix**, nicht nach Reihenfolge. Ohne das kippt jedes hochfrequente Konto in Monotonie.
- **D.5.2 Kanal-Kapazitäts-bewusste Planung:** nutzt B.2 — plant nie mehr ein, als der Kanal verträgt.
- **D.5.3 Ein Konzept → viele Kanäle, nicht ein Text → viele Kanäle.** Heute adaptiert `adapt-content.ts` einen fertigen Text nach unten. Besser: aus dem *Konzept* pro Kanal nativ erzeugen. Ein LinkedIn-Post und ein X-Thread aus derselben Idee sind zwei verschiedene Artefakte, keine zwei Kürzungen desselben Textes. **Das ist der größte Qualitätssprung im ganzen Publish-Workstream** — und der Punkt, an dem sich Prolora sichtbar von jedem Cross-Poster absetzt.
- **D.5.4 Tages-Cockpit:** „Heute: 3 geplant, 2 im Gate, 1 braucht Proof" statt Kalenderraster.

---

## 7. Die Schleife sichtbar machen (querschnittlich)

Ohne diesen Workstream bleibt der Rest eine Feature-Liste.

- **E.1 Herkunfts-Kette:** Jeder Post trägt sichtbar seinen Ursprung: *„Aus 23 Feedbacks zu Onboarding-Verwirrung → Proof: Support-Ticket-Rückgang 31 % → Prognose 78 → Ergebnis: 2,3× über Baseline."* Kein Wettbewerber kann diesen Satz anzeigen. Das ist das verkaufbare Artefakt.
- **E.2 Wochen-Briefing** (Inngest, montags): Was der Markt sagte, was wir belegen können, was zu posten ist. Ein Bildschirm, drei Entscheidungen.
- **E.3 Lernspeicher:** `reconcile.ts`-Ergebnisse fließen in `content_references` zurück — was messbar funktioniert hat, wird zur Vorlage. Die Musterbibliothek wird selbstlernend statt kuratiert.

---

## 8. Frontend-Fundament (Voraussetzung, klein)

Aus der heutigen Sitzung offen geblieben und Basis für alles oben:
- `Modal` ist neu (motion, zentriert, Größen) — **die übrigen 6 Aufrufstellen** auf `size`/`dismissible` prüfen.
- `ConnectRedditPanel` → `ConnectProviderPanel` generalisieren (A.1).
- Wiederkehrendes Muster für mehrstufige Flows (Connect → Konfigurieren → Ergebnis) als gemeinsame `Wizard`-Komponente; heute in `AddCommunitiesButton` ad hoc gelöst und in D.1/D.3 mehrfach nötig.

---

## 9. Reihenfolge

| Phase | Inhalt | Warum diese Reihenfolge |
|---|---|---|
| **0** | §2-Entscheidungen (Budget, tote Kanäle, Gate-Härte) | Blockiert D.4 und D.3 rechnerisch |
| **1** | A.1–A.3 Provider-Registry + Mastodon + Hacker News | Größter Onboarding-Hebel, **null Credentials nötig** |
| **2** | A.4 BYO-OAuth für LinkedIn/X + B.1/B.4 Token-Health | Beseitigt die letzten Env-Sackgassen; Frequenz braucht stabile Kanäle |
| **3** | C.1–C.3 Themen + Proof-Extraktion | Liefert den Rohstoff für D.2 — ohne das läuft die Fabrik leer |
| **4** | D.1 Pipeline-Layer + D.2 Inventory | Orchestriert überwiegend Vorhandenes: bestes Aufwand/Wirkung-Verhältnis |
| **5** | D.3 Quality-Gate + D.5.3 kanal-natives Erzeugen | **Der eigentliche Qualitätssprung** |
| **6** | D.4 Visual System (D.4.3 Video nach eigenem Spike) | Teuerster Teil, profitiert von allem davor |
| **7** | E.1–E.3 Schleife sichtbar | Macht den Moat verkaufbar |

**Migrationen:** 015 (Provider-Erweiterung), 016 (`feedback_themes`), 017 (`content_items` + Varianten), 018 (Brand-Visual-Profile). Jede nach dem STOP-Gate-Muster: erst fragen, dann anwenden.

---

## 10. Offene Entscheidungen für dich

1. **Media-Budget** (§2.1) — welche Größenordnung pro Plan? Ohne Antwort ist D.4 nicht planbar.
2. **Gate-Härte** (§2.3) — darf Prolora einen Post *verweigern*, oder nur dringend warnen? Meine Empfehlung: verweigern, mit bewusstem Übersteuern-Knopf plus Protokoll.
3. **Video-Tiefe** (D.4.3) — eigener Kompositions-Renderer (groß) oder vorerst nur Bild + Karussell? Empfehlung: Phase 6 mit vorgeschaltetem Spike, nicht blind zusagen.
4. **Deutsch als Content-Sprache**: Das Resonanz-Schema und die kuratierte Bibliothek sind deutsch. Bleibt DACH der Fokus (dann ist es Stärke) oder wird international skaliert (dann braucht die Musterbibliothek Lokalisierung)?
