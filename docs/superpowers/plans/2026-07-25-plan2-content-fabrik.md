# Plan 2 — Content-Fabrik: Signale, Qualitäts-Gate, kanal-native Erzeugung

> **Für 2 Agenten parallel.** Agent **2A (Signale & Visuals)** und Agent **2B (Fabrik & Gate)**
> arbeiten gleichzeitig in getrennten Worktrees. Die Dateibesitz-Tabelle in §3 ist bindend.
> Die Verträge in §4 sind vorab fixiert, damit beide sofort starten können.
>
> **Video-Erzeugung ist aus Komplexitätsgründen gestrichen** (Nutzer-Entscheidung
> 2026-07-25). Bilder ja, Video nein — siehe §11.

**Goal:** Aus Signalen (was der Markt sagt) werden **belegte, kanal-native Posts**, die ein
blockierendes Qualitäts-Gate passieren müssen. Ziel-Kadenz 2–3 Posts/Tag ist damit eine
Frage der Kapazität, nicht der Handarbeit.

**Architecture:** Ein neuer Orchestrierungs-Layer `lib/pipeline/` verbindet Bausteine, die
**bereits existieren** (`angle-service`, `concept-service`, `splinter`, `slot-allocator`,
`reconcile`, `reference-matcher`) zu einer Zustandsmaschine. Zwei genuin neue Dinge kommen
hinzu: die **Signal-Gewinnung aus Feedback** (2A) und das **blockierende Quality-Gate** (2B).

**Tech Stack:** Next.js 15, Supabase + pgvector, Inngest, Anthropic Claude, OpenAI
(gpt-image-2), Zod, vitest. Eine mögliche neue Abhängigkeit — siehe Entscheidung D2 in §10.

---

## 1. Die Existenzberechtigung dieses Plans

CEO-Linse, **Inversion** — „Was würde uns scheitern lassen?": 3 Posts/Tag × 8 Kanäle
mittelmäßig sind ~720 Veröffentlichungen im Monat und der schnellste bekannte Weg,
Glaubwürdigkeit zu verbrennen. Jedes hochfrequente KI-Konto endet in derselben
Wiederholungsschleife.

Deshalb ist das Ziel nicht Volumen, sondern **Glaubwürdigkeit, die sich verzinst**. Das
blockierende Gate (§6.2) ist nicht ein Feature unter vielen — es ist der Grund, warum
hohe Frequenz hier überhaupt vertretbar ist. Ein System, das bei Frequenz nicht Nein sagen
kann, ist bei Frequenz gefährlich.

Eng-Linse, **essenzielle vs. zufällige Komplexität**: Der überwiegende Teil dieses Plans
ist Orchestrierung vorhandener Teile. Genuin neu sind nur Signal-Gewinnung und Gate. Das
ist das beste Aufwand/Wirkung-Verhältnis im gesamten Roadmap-Bestand — vorausgesetzt, wir
widerstehen der Versuchung, die vorhandenen Services „bei der Gelegenheit" umzuschreiben.

---

## 2. Systemüberblick

```
 QUELLEN (2A)                    ZUSTANDSMASCHINE (2B)              SENKEN
 ────────────                    ─────────────────────              ──────
 feedback_items ──┐
   themes.ts      │
   (Momentum)     │
                  │   Vertrag C3
 proof_assets ────┼──► Signal[] ──► angle ──► concept ──► draft_set(N)
   proof-         │    (§4.1)       (vorh.)   (vorh.)      (kanal-nativ)
   extraction.ts  │                                            │
                  │                                            ▼
 discovery_       │                                     ╔══════════════╗
   communities ───┤                                     ║ QUALITY GATE ║ ◄── blockierend
   (top_recurring │                                     ║  1 Proof     ║
    _questions)   │                                     ║  2 Struktur  ║
                  │                                     ║  3 determin. ║
 content_refs ────┤                                     ║  4 Selbst-   ║
   (Gewinner aus  │                                     ║    ähnlichk. ║
    reconcile)    │                                     ╚══════╤═══════╝
                  │                                            │ bestanden
                  ▼                                            ▼
            inventory.ts ────────────────────────────►  scheduled
            "Reichweite: 12 Tage"                     (slot-allocator, vorh.)
                  ▲                                            │
                  │                                            ▼
                  │                                        published
                  │                                            │
                  └──────── reconcile.ts (vorh.) ◄─────── measured
                            Gewinner werden Vorlage
```

**Zustandsmaschine `content_items.state`:**

```
  signal ──► angled ──► concepted ──► drafted ──► gated ──► scheduled ──► published ──► measured
     │          │           │            │          │
     └──────────┴───────────┴────────────┴──────────┴──► rejected (mit Grund, nie stillschweigend)
```

Jeder Übergang schreibt `reason` und `actor` (`system` | `user`). Ein `rejected` ohne Grund
ist ein Bug, kein Zustand.

---

## 3. Dateibesitz (bindend)

| Pfad | Besitzer | Anmerkung |
|---|---|---|
| `lib/feedback/themes.ts` | **2A** | neu |
| `lib/feedback/proof-extraction.ts` | **2A** | neu |
| `lib/pipeline/inventory.ts` | **2A** | neu — einzige `lib/pipeline/`-Datei von 2A |
| `lib/media/brand-profile.ts` | **2A** | neu |
| `lib/media/visual-templates/**` | **2A** | neu |
| `app/api/v1/themes/**`, `app/api/v1/visuals/**` | **2A** | |
| `supabase/migrations/016_feedback_themes.sql` | **2A** | |
| `supabase/migrations/018_brand_visual_profile.sql` | **2A** | |
| `lib/pipeline/state.ts` | **2B** | Zustandsmaschine |
| `lib/pipeline/quality-gate.ts` | **2B** | |
| `lib/pipeline/channel-native.ts` | **2B** | |
| `lib/pipeline/orchestrator.ts` | **2B** | |
| `app/api/v1/pipeline/**` | **2B** | |
| `app/(dashboard)/publish/**` | **2B** | |
| `supabase/migrations/017_content_items.sql` | **2B** | |
| `lib/ai/adapt-content.ts` | **2B** | wird von 2B ersetzt/ergänzt (§6.3) |

**Kollisionsfreiheit:** Beide arbeiten in `lib/pipeline/`, aber auf **disjunkten Dateien**
(2A nur `inventory.ts`). Git kollidiert dabei nicht. Drei Migrationsdateien, drei
verschiedene Nummern, kein Konflikt.

**Konflikt mit laufender Arbeit:** An `app/(dashboard)/listen/**` hat am 2026-07-25 eine
andere Session gearbeitet. **2A fasst die Listen-UI nicht an** — nur Backend plus eigene
API-Routen. Die Themen-Ansicht in der Listen-UI ist bewusst aufgeschoben (§11).

---

## 4. Verträge (vorab fixiert)

### 4.1 C3 — Signal (2A produziert, 2B konsumiert)

```ts
// lib/pipeline/inventory.ts — Besitzer 2A, Konsument 2B
export type SignalKind =
  | 'feedback_theme'      // wiederkehrendes Thema mit Momentum
  | 'unused_proof'        // belegtes Ergebnis, das nie erzählt wurde
  | 'community_question'  // wiederkehrende Frage aus discovery_communities
  | 'splinter'            // Longform-Baustein
  | 'winner_followup';    // Post, der messbar über Baseline lag

export interface Signal {
  id: string;
  workspaceId: string;
  kind: SignalKind;
  title: string;
  /** Worauf sich das stützt — Basis für die Herkunfts-Kette in der UI. */
  evidence: {
    proofAssetIds: string[];
    feedbackItemIds: string[];
    communityIds: string[];
    referenceIds: string[];
  };
  /** 0..1 — Dringlichkeit. Momentum bei Themen, Baseline-Abstand bei Gewinnern. */
  strength: number;
  /** Nach diesem Zeitpunkt ist das Signal kalt (z. B. Nachrichtenbezug). */
  staleAfter: string | null;
  createdAt: string;
}

export function listSignals(
  workspaceId: string, opts?: { minStrength?: number; kinds?: SignalKind[]; limit?: number }
): Promise<Signal[]>;

/** Tage, für die geplanter Content vorhanden ist. Speist die Reichweiten-Ampel. */
export function getCoverageDays(workspaceId: string): Promise<number>;
```

**Wichtig:** `evidence` ist nicht optional und nicht kosmetisch. Das Gate (§6.2, Prüfung 1)
liest daraus. Ein Signal ohne Evidenz kann nie zu einem Post führen, der das Gate besteht.

### 4.2 C4 — Gate-Ergebnis (2B, für UI und API)

```ts
// lib/pipeline/quality-gate.ts — Besitzer 2B
export type GateCheck = 'proof_binding' | 'structure' | 'deterministic' | 'self_similarity';

export interface GateFinding {
  check: GateCheck;
  passed: boolean;
  /** Für den Menschen, in der UI-Sprache des Workspaces. */
  message: string;
  /** Maschinenlesbar, damit die UI die richtige Reparatur-Aktion anbietet. */
  remedy: 'add_proof' | 'rewrite_structure' | 'shorten' | 'differentiate' | null;
  /** Textstelle, die das Problem auslöst — für Inline-Markierung. */
  span: { start: number; end: number } | null;
}

export interface GateResult {
  passed: boolean;
  findings: GateFinding[];
  /** Gesetzt, wenn der Nutzer bewusst übersteuert hat. Wird protokolliert. */
  overriddenBy: string | null;
}
```

### 4.3 Konsum aus Plan 1

2B ruft `getChannelCapacity(workspaceId)` aus `lib/connections/capacity.ts` (Plan 1 / 1B).
**Falls Plan 1 noch nicht fertig ist:** gegen den Vertrag programmieren und einen lokalen
Stub verwenden, der `remainingToday: null` liefert. Der Plan ist dadurch **nicht**
blockiert.

---

## 5. Agent 2A — Signale & Visuals

### 2A.1 Theme-Clustering (`lib/feedback/themes.ts`)
Die pgvector-Embeddings werden heute nur für Dedupe genutzt. Dieselben Vektoren clustern zu
**persistenten Themen** mit Verlauf über Wochen (Migration 016: `feedback_themes`,
`feedback_theme_members`). Liefert „Onboarding-Verwirrung: 23 Nennungen".

**Fallstrick, der eingeplant gehört:** Cluster-Identität muss über Läufe hinweg **stabil**
sein, sonst springt jedes Thema wöchentlich um und Momentum wird Rauschen. Lösung:
Zentroid-Matching gegen bestehende Themen mit Ähnlichkeitsschwelle, neues Thema nur unter
der Schwelle. Nicht bei jedem Lauf neu clustern.

### 2A.2 Momentum-Erkennung
Nicht „was ist häufig", sondern „was ist **neu** oder **beschleunigt**". Ein Thema von 2 auf
14 Nennungen ist der beste und zeitkritischste Post-Anlass. Speist `Signal.strength`.
Baselines nach demselben median/MAD-Muster wie `lib/scoring/baseline.ts` — dasselbe
Verfahren, dieselbe Robustheit gegen Ausreißer, kein zweites Konzept im Code.

### 2A.3 Proof-Extraktion (`lib/feedback/proof-extraction.ts`)
Erkennt in eingehendem Feedback belegbare Aussagen (konkretes Zitat, messbares Ergebnis)
und schlägt sie als `proof_asset` vor — **mit Quelle und ausdrücklichem Zustimmungs-Status**.

**Harte Regel:** Kein automatisches Anlegen. Vorschlag → Nutzer bestätigt → erst dann
`proof_asset`. Ein automatisch erzeugter „Beleg" wäre exakt die Fabrikation, gegen die das
gesamte Proof-Konzept gebaut wurde. Bei Kundenzitaten kommt DSGVO dazu (§8).

### 2A.4 Inventory (`lib/pipeline/inventory.ts`)
Vereint die fünf Quellen aus C3 zu einer Liste. `getCoverageDays` beantwortet „für wie viele
Tage habe ich Stoff". `top_recurring_questions` in `discovery_communities` wird heute
erhoben und **nirgends genutzt** — hier bekommt es endlich einen Konsumenten.

### 2A.5 Brand-Visual-Profile (Migration 018)
Palette, Typografie, Bildsprache, Logo-Platzierung als Workspace-Asset. Fließt in **jeden**
Bild-Prompt. Ohne das erzeugen 75 Posts/Monat visuellen Wildwuchs und die Marke verschwindet.

### 2A.6 Deterministische Bild-Templates
Zitat-Karte, Datenpunkt-Karte, Vorher-Nachher, Framework-Diagramm, Screenshot-Rahmen.
**Serverseitig deterministisch gerendert**, kein Generierungs-Aufruf.

Das ist zugleich die Antwort auf das Budget-Problem: Bei 10 €/Monat und 0,12 €/Bild sind
75 Posts mit Auswahl-Verwerfungen nicht finanzierbar. Deterministische Templates kosten
**null** und sind konsistenter als jede Generierung. Generiert wird nur dort, wo es
wirklich ein Bild sein muss. → Entscheidung D2 (§10).

---

## 6. Agent 2B — Fabrik & Gate

### 2B.1 Zustandsmaschine + Orchestrator (Migration 017)
`content_items` + `content_item_variants` nach dem Diagramm in §2. `orchestrator.ts` fährt
die Übergänge und ruft die **vorhandenen** Services (`angle-service`, `concept-service`).

**Ausdrückliche Nicht-Aufgabe:** Die vorhandenen Services werden **nicht** umgeschrieben.
Wenn ihre Signaturen nicht passen, kommt ein dünner Adapter davor. Ein Refactor mitten in
einem Parallel-Plan ist genau die Art von Änderung, die zwei Agenten gegeneinander laufen
lässt.

### 2B.2 Quality-Gate — blockierend (`quality-gate.ts`)
Vier Prüfungen in dieser Reihenfolge, **Abbruch bei Nichtbestehen**:

1. **Proof-Bindung (hart).** Jede überprüfbare Behauptung — Zahl, Ergebnis, Vergleich — muss
   auf ein `proof_asset` aus `Signal.evidence` zeigen. Unbelegte Zahl → blockiert, nicht
   kommentiert. Das ist die Durchsetzung der Anti-Fabrikations-Invariante, die im Datenmodell
   seit Migration 012 angelegt, aber nie erzwungen ist.
2. **Struktur.** Erfüllt der Entwurf das Resonanz-Schema
   (`beweisbarer_ausgangspunkt → bruch → unerwarteter_befund → mechanismus → handlungsregel → reibungsfrage`)?
   Fehlender `unerwarteter_befund` = generischer Post = blockiert.
3. **Deterministisch.** `lib/scoring/deterministic.ts` (existiert) mit **Schwelle** statt nur
   Punktzahl. Kostet keine KI-Credits und ist sofort.
4. **Selbstähnlichkeit.** Embedding-Vergleich gegen die eigenen letzten 90 Tage. Zu ähnlich →
   blockiert. Das ist die Prüfung, die die Wiederholungsschleife verhindert, in der jedes
   hochfrequente Konto endet.

**Übersteuern:** Ein Knopf, der protokolliert (`overriddenBy`, Zeitstempel, Grund). Ohne
Protokoll ist ein Gate nur eine Bitte. → Entscheidung D1 (§10).

### 2B.3 Kanal-native Erzeugung (`channel-native.ts`)
Heute kürzt `adapt-content.ts` einen fertigen Text nach unten. Neu: **aus dem Konzept pro
Kanal nativ erzeugen**. Ein LinkedIn-Post und ein X-Thread aus derselben Idee sind zwei
verschiedene Artefakte, keine zwei Kürzungen desselben Textes.

Das ist der größte Qualitätssprung des Plans und der Punkt, an dem sich Prolora sichtbar von
jedem Cross-Poster absetzt. `PLATFORM_STYLE` aus `adapt-content.ts` bleibt als Regelquelle
erhalten und wird von Plattform- auf Kanal-Ebene erweitert.

**Kosten-Realität, die eingeplant gehört:** N Kanäle nativ zu erzeugen kostet N LLM-Aufrufe
statt einem. Bei 75 Posts × 4 Kanälen sind das 300 statt 75. Batching pro Konzept (ein
Aufruf, mehrere Kanäle in einem strukturierten Tool-Result) hält das beherrschbar — dasselbe
Muster, das `evaluateCommunities` bereits nutzt.

### 2B.4 Frequenz-Motor
Content-Mix-Regeln (z. B. 40 % Insight, 30 % Proof/Case, 20 % Story, 10 % Frage). Der
Scheduler wählt aus dem Inventory **nach Mix**, nicht nach Reihenfolge — sonst kippt jedes
hochfrequente Konto in Monotonie. Nutzt `slot-allocator.ts` (existiert, DST-sicher) und
`getChannelCapacity` (Plan 1, Vertrag §4.3).

### 2B.5 Publish-UI
Tages-Cockpit statt Kalenderraster: „Heute: 3 geplant, 2 im Gate, 1 braucht Proof".
Gate-Ergebnis als Diagnose mit konkretem nächsten Schritt (`remedy` aus C4), Textstelle
inline markiert (`span`). Bei `add_proof` direkt der Knopf zum Anlegen. Herkunfts-Kette
sichtbar: *„Aus 23 Feedbacks → Proof: Ticket-Rückgang 31 % → Prognose 78."*

---

## 7. Integrations-Task I2 (ein Agent, nach beiden Strängen)

1. Migrationen 016/017/018 anwenden (STOP-Gate, §9).
2. `tsc --noEmit` beide Apps, `npx vitest run` vollständig grün, `npm run build`.
3. Ein Durchlauf Ende-zu-Ende: Feedback-Thema → Signal → Konzept → 2 Kanal-Varianten →
   Gate → geplant.
4. **Gate-Negativtest von Hand:** Ein Entwurf mit erfundener Zahl **muss** blockiert werden.
   Besteht er, ist das Gate wirkungslos und der Plan nicht fertig.

---

## 8. Failure Modes

| Codepfad | Realistischer Produktionsfehler | Abgedeckt durch |
|---|---|---|
| Theme-Clustering | Cluster-Identität springt zwischen Läufen → Momentum wird Rauschen | Zentroid-Matching mit Schwelle (2A.1), Test auf Stabilität über zwei Läufe |
| Proof-Extraktion | LLM erfindet einen „Beleg" aus vagem Feedback | Kein Auto-Anlegen; Zustimmung zwingend; Quelle immer verlinkt |
| Proof-Extraktion | Kundenzitat wird ohne Rechtsgrundlage zum Marketing-Asset | DSGVO: Herkunft + Zustimmungsstatus am `proof_asset`; ohne Zustimmung nicht im Gate verwendbar |
| Quality-Gate | Gate blockiert **alles**, Nutzer kommt nie zum Posten | Schwellen konfigurierbar; Gate-Statistik im Cockpit; Übersteuern mit Protokoll |
| Quality-Gate | Selbstähnlichkeits-Prüfung ohne Historie blockiert die ersten Posts | < 10 Posts Historie → Prüfung 4 wird übersprungen, nicht „bestanden" gemeldet |
| Kanal-native Erzeugung | N Kanäle = N LLM-Aufrufe, Credits brennen | Batching pro Konzept (2B.3); Credit-Schätzung **vor** dem Lauf |
| Orchestrator | Item bleibt in einem Zwischenzustand hängen | Jeder Zustand hat Timeout + `stalled`-Erkennung; Inngest-Job räumt auf |
| Inventory | Signale versiegen, Kadenz bricht ein | `getCoverageDays` + Ampel **bevor** es passiert, nicht danach |
| Bild-Budget | 10 €/Monat reicht für 75 Posts mit Auswahl nicht | Deterministische Templates kosten null (2A.6); Entscheidung D2 |

---

## 9. Migrations-STOP-Gate

Migrationen 016, 017, 018 werden **geschrieben, aber nicht angewendet**. Beide Agenten
melden sich beim Nutzer und warten. Grund: CLAUDE.md-Guardrail; zusätzlich hat die
Supabase-CLI in diesem Repo keinen Projekt-Link, Anwendung läuft über den SQL-Editor.

---

## 10. Offene Entscheidungen (blockieren Teile des Plans)

**D1 — Gate-Härte.** Darf Prolora einen Post *verweigern*, oder nur dringend warnen?
*Empfehlung: verweigern, mit protokolliertem Übersteuern-Knopf.* Ein Gate ohne Nein ist
eine Bitte, und Bitten skalieren nicht auf 720 Veröffentlichungen im Monat. Betrifft 2B.2.

**D2 — Rendering der Bild-Templates.** Deterministische Templates brauchen einen
serverseitigen Renderer (z. B. `satori` / `@vercel/og` → SVG/PNG). Das ist eine **neue
externe Abhängigkeit** und damit laut CLAUDE.md zustimmungspflichtig.
*Empfehlung: ja.* Es ersetzt bezahlte Generierungen durch kostenloses Rendering und löst
das Budget-Problem, statt es zu verwalten. Alternative ohne neue Abhängigkeit: nur
generierte Bilder — dann bleibt das Budget der Engpass. Betrifft 2A.6.

**D3 — Media-Budget.** Auch mit Templates bleiben generierte Bilder nötig. 10 €/Monat
erlauben 83 Generierungen **ohne** Verwerfungen. Qualität entsteht aber durch Auswahl.
*Empfehlung: plan-abhängig (Starter 10 € / Pro 60 € / Agency 200 €).* Das Ledger
(`media_budget_ledger`, atomare Reservierung) ist gut gebaut und bleibt — nur die Zahl ist
zu klein.

---

## 11. NOT in scope (bewusst gestrichen)

| Gestrichen | Warum |
|---|---|
| **Video-Erzeugung und -Komposition** | Nutzer-Entscheidung 2026-07-25: zu komplex. Ein 8-s-Sora-Clip ist ohnehin kein Value-Post; echte Komposition (Screen-Recording + Untertitel + B-Roll) ist ein eigener Plan mit vorgeschaltetem Spike. |
| **Listen-UI (Themen-Ansicht)** | An diesen Dateien arbeitet parallel eine andere Session. Backend liefert die API, die UI folgt in einem separaten Schritt nach Abgleich. |
| **Plattform-native Sonderformate** (LinkedIn-Karussell-PDF, Shorts-Vertikalschnitt) | Erst wenn kanal-native Text-Erzeugung (2B.3) steht und sich bewährt hat. |
| **Wochen-Briefing, Lernspeicher** (E.2/E.3 des Ursprungsplans) | Setzen voraus, dass die Pipeline Daten produziert hat. Ohne Betriebshistorie wäre das Spekulation. |
| **Kanal-Profil pro Account** (Tonalität, Tabus je Account) | Sinnvoll erst nach 2B.3. Dann klein nachrüstbar. |
| **Selbstlernende Musterbibliothek** | Braucht mehrere Monate `reconcile`-Daten. Verfrüht. |

---

## 12. Was bereits existiert (nicht neu bauen)

| Vorhanden | Umgang |
|---|---|
| `lib/content/angle-service.ts`, `concept-service.ts`, `splinter.ts`, `reference-matcher.ts` | **Werden orchestriert, nicht umgeschrieben.** Bei Signatur-Bruch: Adapter davor. |
| `lib/posts/slot-allocator.ts` (DST-sicher), `posting-schedules.ts` | 2B.4 **nutzt** sie. |
| `lib/scoring/deterministic.ts`, `baseline.ts`, `reconcile.ts`, `content-hash.ts` | Gate-Prüfung 3 und Momentum-Baselines **wiederverwenden**, kein zweites Verfahren. |
| `proof_assets` (Mig. 012), `content_references` mit Resonanz-Schema (Mig. 013) | Datenmodell für Gate-Prüfungen 1 und 2 steht bereits. |
| `lib/ai/embeddings.ts` + pgvector | Theme-Clustering **und** Selbstähnlichkeits-Prüfung nutzen dieselbe Infrastruktur. |
| `media_budget_ledger` + atomare Reservierungs-RPC | Bleibt unangetastet. Nur der Grenzwert steht zur Diskussion (D3). |
| `lib/ai/adapt-content.ts` `PLATFORM_STYLE` | Regelquelle bleibt, wird von Plattform- auf Kanal-Ebene erweitert. |
| Batching-Muster aus `evaluateCommunities` | Vorlage für 2B.3, damit N Kanäle nicht N Aufrufe kosten. |
