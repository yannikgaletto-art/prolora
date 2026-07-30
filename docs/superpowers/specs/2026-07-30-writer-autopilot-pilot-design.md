# Prolora Writer — Approval-first Autopilot Pilot

**Status:** vom Nutzer abschnittsweise bestätigt
**Datum:** 2026-07-30
**Produktbereich:** Publish
**Auslieferungsform:** zusätzlicher, isolierter Reiter `Writer`

## 1. Zusammenfassung

Prolora erhält unter `Publish` einen zusätzlichen Reiter **Writer**. Der Writer ist ein pausierbarer Pilot für eine weitgehend autonome Content-Produktion. Er erkennt geeignete Themen aus bereits vorhandenen Signalen, erzeugt einen belegten Canonical Draft, adaptiert ihn kanalnativ, prüft und repariert ihn, schlägt einen Veröffentlichungszeitpunkt vor und legt dem Nutzer genau einen fertigen Vorschlag zur Freigabe vor.

Der reguläre Nutzerpfad endet bei einer einzigen Pflichtaktion:

> **Freigeben & einplanen**

Kein Writer-Post wird ohne eine persönliche Einzelfreigabe veröffentlicht. Die Freigabe bindet einen unveränderlichen Snapshot. Jede inhaltlich relevante Änderung nach der Freigabe macht diese ungültig.

Alle bestehenden Publish-Flächen und Workflows bleiben bestehen. Der Writer ersetzt, löscht oder benennt weder `Start`, `Compose`, `Fabrik`, `Calendar`, `Content Hub`, `Posts` noch `Media` um. Erst nach einem messbaren Pilot entscheidet der Nutzer, ob Teile des Writers später zum Standard werden.

## 2. Ziele und Erfolgskriterien

### 2.1 Produktziel

Nach abgeschlossenem Setup erreicht mindestens 95 % der geeigneten Content-Slots ohne weitere Nutzereingabe einen belegten, Content-DNA-gerechten, kanalnativen, gate-bestandenen und bereits sinnvoll terminierten Vorschlag in der Writer-Freigabe-Inbox.

„95 % automatisiert“ bedeutet nicht unbeaufsichtigtes Veröffentlichen. Es bedeutet, dass der Mensch im Steady State nur noch eine Go-/No-Go-Entscheidung trifft.

### 2.2 Pilotmetriken

Die Pilotbewertung beginnt nach mindestens 20 bewerteten Writer-Posts. Die folgenden Ziele gelten rollierend:

- `ready_to_approve_rate >= 95 %`
- mediane aktive Prüfzeit pro Post `<= 45 Sekunden`
- p90 der aktiven Prüfzeit `<= 120 Sekunden`
- mindestens `85 %` Freigaben ohne Textänderung
- durchschnittliche normalisierte Edit-Distanz `< 5 %`
- `exception_rate <= 5 %`
- `approval_bypass_count = 0`
- `snapshot_mismatch_publish_count = 0`
- `duplicate_external_publish_count = 0`
- `wrong_workspace_or_destination_count = 0`
- `unconsented_proof_publish_count = 0`
- `unsupported_claim_publish_count = 0`
- `100 %` der Writer-Publikationen besitzen Quellen-, DNA-, Prompt-, Gate- und Approval-Versionen
- Publishing-Erfolg `>= 99 %`, externe Plattformausfälle separat ausgewiesen

## 3. Nicht-Ziele des Piloten

- Kein Auto-Publish ohne Einzelfreigabe.
- Kein Ersatz oder Rückbau bestehender Publish-Flows.
- Kein Chat-Agent als primäre Bedienoberfläche.
- Kein Workflow-Builder für frei programmierbare Agentenketten.
- Kein kundenspezifisches Fine-Tuning.
- Kein neuer Microservice, Eventbus oder externer Vector Store.
- Keine automatische externe Trend-Recherche.
- Keine automatische Umwandlung von Rohfeedback in öffentlich nutzbare Kundenbelege.
- Keine automatischen Community-Posts oder Replies.
- Keine stillschweigende Veränderung der Creator-Identität anhand von Engagement.
- Keine automatische Freigabe von Gate-Overrides, Consent oder rechtlich riskanten Aussagen.
- Keine verpflichtende Mediengenerierung; Text-only muss vollständig funktionieren.

## 4. Bestehendes Fundament

Der Pilot verwendet die vorhandene Architektur und schließt ihre End-to-End-Lücken:

- Produktprofil und Proof Assets aus Migration `012_product_profile.sql`
- Referenzmuster aus `013_content_references.sql`
- Creator-Style-Präferenz aus `010_creator_style.sql`
- Posting-Schedules aus `011_posting_schedules.sql`
- Impact Predictions und Outcome-Kalibrierung aus `009_impact_predictions.sql`
- Content-Fabrik und kanalnative Varianten aus `017_content_items.sql`
- Brand Visual Profile aus `018_brand_visual_profile.sql`
- Signal-Inventar, Concept-Service, Channel-Native-Service und Quality Gate unter `apps/web/lib/pipeline/`
- bestehende Publishing Authority `post_groups` und `post_items`
- bestehende Inngest-Publishing- und Metrics-Jobs

`post_groups` und `post_items` bleiben die einzige Publishing-Wahrheit. `content_items` repräsentieren weiterhin die Produktion vor der Materialisierung.

## 5. Informationsarchitektur und UX

### 5.1 Navigation

Die Publish-Navigation wird ausschließlich ergänzt:

`Start | Writer (Pilot) | Compose | Fabrik | Calendar | Content Hub | Posts | Media`

`Writer` liegt neben `Start`, weil er den schnellsten Einstieg in die Content-Produktion darstellt. Ein `Pilot`- beziehungsweise `New`-Badge kennzeichnet den experimentellen Status.

### 5.2 Writer-Bereiche

Der Writer besitzt drei interne Ansichten:

1. **Heute** — Freigabe-Inbox und laufende Vorbereitung.
2. **Content DNA** — Golden Samples, Avoid Samples, extrahierte Stilmerkmale und Konfidenz.
3. **Verlauf** — Freigaben, Änderungen, Ablehnungen, Exceptions und Outcomes.

### 5.3 Ansicht „Heute“

Die Seite zeigt vier kompakte Statuswerte:

- wartet auf Freigabe
- wird vorbereitet
- Golden Samples gelernt
- Ausnahmen benötigen Hilfe

Die primäre Review-Karte enthält:

- Titel und Fold-Preview
- exakten Post pro Kanal
- Thread-Segmente, sofern vorhanden
- Medien, Alt-Text und First Comment
- Zielplattform und konkretes Verbindungskonto
- vorgeschlagene lokale Zeit, Zeitzone und UTC-Zeit
- „Warum jetzt?“ mit Signal- und Content-Mix-Begründung
- überprüfbare Claims mit Quellenbezug
- Content-DNA-Konfidenz und verwendete Samples
- Gate-Ergebnis, Warnungen, übersprungene Checks und Overrides
- Änderungen gegenüber einer früheren Review-Version

Primäre Aktion:

- **Freigeben & einplanen**

Sekundäre Aktionen:

- **Ändern** — öffnet eine fokussierte Inline-Bearbeitung; Speichern erzeugt einen neuen Review-Snapshot.
- **Andere Idee** — verwirft nicht das Item, sondern fordert genau eine alternative Richtung an.
- **Ablehnen** — verlangt einen kurzen strukturierten Grund und optionalen Freitext.
- einzelne Kanäle abwählen

Der Writer generiert standardmäßig genau einen empfohlenen Vorschlag. Drei gleichzeitige Varianten würden die Entscheidungsarbeit erhöhen und sind daher kein Default.

### 5.4 Content DNA

Samples können hinzugefügt werden durch:

- Text einfügen
- URL importieren
- eigenen bereits veröffentlichten Post übernehmen

Jedes Sample wird gekennzeichnet als:

- `golden` — erwünschter Stil
- `avoid` — unerwünschter Stil

Optional wird die Herkunft als `pasted`, `published` oder `imported` erfasst. Ein Sample kann deaktiviert werden, ohne gelöscht zu werden. Doppelte Samples werden über einen workspace-gescopten Content-Hash verhindert.

Die UI zeigt keine scheinpräzise DNA bei zu wenig Material:

- 0–2 aktive Golden Samples: neutraler Fallback, geringe Konfidenz
- 3–4 Samples: vorläufiges Profil, nur weiche Stilhinweise
- 5–14 Samples: belastbares Profil
- ab 15 Samples: präzises Profil; weiterhin keine Garantie

Der Nutzer kann einzelne extrahierte Regeln korrigieren oder sperren. Gesperrte Regeln werden durch spätere Lernsignale nicht überschrieben.

## 6. Zielarchitektur

```text
Sources
  -> Signal Inventory
  -> content_items
  -> Angle
  -> Concept
  -> channel-native content_item_variants
  -> Quality Gate
  -> bounded Auto-Repair
  -> awaiting_approval
  -> immutable Review Snapshot
  -> explicit User Approval
  -> atomic Materialize + Schedule
  -> post_groups / post_items
  -> existing Publisher
  -> Metrics + Reconcile
  -> controlled Learning
```

Der Writer führt keine Plattform-Adapter direkt aus. Externe Publikation erfolgt ausschließlich über bestehende `post_items`-Jobs.

## 7. Datenmodell

Die nächste freie Migrationsnummer ist im aktuellen Arbeitsbaum `020`, da `019_community_membership.sql` bereits als uncommitted Nutzeränderung existiert. Keine vorhandene Migration wird editiert.

### 7.1 Migration `020_writer_integrity.sql`

Diese Migration schafft zuerst das Integritätsfundament:

- erweitert den zulässigen `content_items.state` um `awaiting_approval`
- ergänzt `post_items.content_item_variant_id UUID NULL UNIQUE`
- fügt die nötigen Foreign Keys und Indizes hinzu
- führt eine transaktionale RPC `transition_content_item(...)` ein
- führt eine idempotente RPC `materialize_writer_bundle(...)` ein
- führt eine atomare RPC `claim_post_item(...)` ein

`transition_content_item(...)` prüft den erwarteten Ausgangszustand und schreibt State-Änderung und Transition-Audit in derselben Transaktion.

`materialize_writer_bundle(...)`:

1. prüft Workspace, Review-Status und Snapshot-Hash,
2. prüft, dass alle ausgewählten Varianten harte Gates bestanden haben,
3. erzeugt genau eine `post_group`-Zeile,
4. erzeugt pro ausgewählter Variante genau eine `post_item`-Zeile,
5. verknüpft `content_item_variant_id`,
6. schreibt `content_items.post_group_id`,
7. setzt den verbindlichen Slot,
8. wechselt das Item zu `scheduled`,
9. schreibt den Audit-Übergang,
10. liefert bei Wiederholung dasselbe Resultat zurück.

`claim_post_item(...)` stellt sicher, dass bei konkurrierenden Inngest-Events genau ein Worker das externe Publishing ausführt.

### 7.2 Migration `021_content_dna.sql`

#### `content_samples`

- `id UUID`
- `workspace_id UUID`
- `kind TEXT CHECK ('golden','avoid')`
- `origin TEXT CHECK ('pasted','published','imported')`
- `platform TEXT NULL`
- `content TEXT`
- `source_post_item_id UUID NULL`
- `source_url TEXT NULL`
- `label TEXT NULL`
- `active BOOLEAN DEFAULT true`
- `content_hash TEXT`
- `embedding VECTOR(1536) NULL`
- `created_at`, `updated_at`
- Unique `(workspace_id, kind, content_hash)`
- RLS und explizites Workspace-Scoping

#### `content_dna_profiles`

- `id UUID`
- `workspace_id UUID`
- `version INTEGER`
- `status TEXT CHECK ('building','active','failed','superseded')`
- `sample_set_hash TEXT`
- `schema_version TEXT`
- `profile JSONB`
- `confidence JSONB`
- `locked_rules JSONB DEFAULT '[]'`
- `sample_count INTEGER`
- `model TEXT`
- `prompt_version TEXT`
- `created_at`
- maximal ein aktives Profil je Workspace

DNA-Profile sind immutable. Eine Änderung des Sample-Sets erzeugt eine neue Version.

### 7.3 Migration `022_writer_pilot.sql`

#### `workspace_writer_policies`

- `workspace_id UUID PRIMARY KEY`
- `enabled BOOLEAN DEFAULT false`
- `mode TEXT DEFAULT 'approval_required'`
- `allowed_connection_ids UUID[]`
- `daily_post_cap INTEGER`
- `weekly_credit_cap INTEGER`
- `minimum_signal_strength REAL`
- `content_mix JSONB`
- `quiet_days INTEGER[]`
- `timezone TEXT`
- `dna_profile_id UUID NULL`
- `policy_version INTEGER`
- `updated_by TEXT`
- `created_at`, `updated_at`

Im Pilot ist ausschließlich `approval_required` erlaubt. Das Schema reserviert keinen aktiven `auto_publish`-Modus.

#### `writer_review_bundles`

- `id UUID`
- `workspace_id UUID`
- `content_item_id UUID`
- `status TEXT CHECK ('pending','approved','invalidated','rejected','expired')`
- `snapshot JSONB`
- `snapshot_hash TEXT`
- `variant_hashes JSONB`
- `source_set_hash TEXT`
- `dna_profile_id UUID`
- `dna_version INTEGER`
- `prompt_version TEXT`
- `gate_version TEXT`
- `policy_version INTEGER`
- `expires_at TIMESTAMPTZ`
- `approved_by UUID NULL`
- `approved_at TIMESTAMPTZ NULL`
- `rejected_by UUID NULL`
- `rejected_at TIMESTAMPTZ NULL`
- `rejection_reason TEXT NULL`
- `superseded_by UUID NULL`
- `created_at`

Pro Content Item darf maximal ein aktives `pending`-Bundle existieren.

## 8. Interne Schnittstellen

### 8.1 Generation Context

Ein zentraler Resolver `loadGenerationContext(workspaceId)` führt zusammen:

- `workspace_contexts`
- `voice_configs`
- Produktprofil und consent-fähige Proof Assets
- aktives Content-DNA-Profil
- 1–2 passend geretrievte Samples derselben Plattform
- Writer-Policy
- relevante Referenzmuster

Concept Service, Channel-Native-Service, Template Drafting, Scoring und Quality Gate verwenden denselben Resolver. Dadurch verschwindet die heutige Kontextfragmentierung.

### 8.2 Writer APIs

Neue APIs bleiben unter `/api/v1/writer/*` isoliert:

- `GET /status`
- `PATCH /policy`
- `POST /run`
- `GET /reviews`
- `GET /reviews/:id`
- `POST /reviews/:id/approve`
- `POST /reviews/:id/request-change`
- `POST /reviews/:id/reject`
- `GET /samples`
- `POST /samples`
- `PATCH /samples/:id`
- `DELETE /samples/:id`
- `POST /dna/rebuild`
- `GET /dna`

Mutierende Routen authentifizieren Workspace und Rolle. Freigaben sind nur für `owner` oder `admin` erlaubt. API-Key-Freigabe und MCP-Freigabe sind im Pilot nicht erlaubt.

### 8.3 Writer Worker

Ein eigener Inngest-Worker läuft zunächst nur auf explizites `writer/run`-Event. Nach dem Shadow-Test kann ein täglicher Cron aktiviert werden.

Der Worker:

1. prüft `enabled`, Kill Switch, Credits und freie Coverage,
2. wählt das stärkste frische, nicht deduplizierte Signal,
3. erzeugt genau ein Content Item,
4. führt es bis zu kanalnativen Varianten,
5. führt das Quality Gate aus,
6. repariert maschinenlesbare Findings höchstens dreimal,
7. reserviert einen unverbindlichen Slot-Vorschlag,
8. erzeugt einen immutable Review-Snapshot,
9. setzt `awaiting_approval`,
10. benachrichtigt ausschließlich über einen in-app Status im ersten Pilot.

Der Worker plant oder veröffentlicht niemals ohne Freigabe.

## 9. Approval-Vertrag

Ein Writer-Approval bindet mindestens:

- `approval_id`
- `workspace_id`
- freigebender User und Rolle
- vollständigen Snapshot-Hash
- Hash jeder Kanalvariante
- Text, Segmente, Medien, Medien-Hashes und Alt-Text
- First Comment
- Zielplattform, Connection und Account
- lokale Zeit, Zeitzone und UTC-Zeit
- Source-Set-Hash
- DNA-, Prompt-, Gate- und Policy-Version
- Freigabezeitpunkt

Eine Änderung an einem der folgenden Felder invalidiert die Freigabe:

- Inhalt oder Thread-Segmente
- Medien, Alt-Text oder First Comment
- Zielplattform, Connection oder Account
- Quellen, Consent oder Provenance
- DNA-, Prompt-, Gate- oder Policy-Version
- Plattformregeln
- geplanter Zeitpunkt

Im Pilot erzeugt auch eine Zeitänderung einen neuen Review-Snapshot. Diese strengere Regel vereinfacht die Beweisbarkeit und kann nach dem Pilot anhand der Daten gelockert werden.

Unmittelbar vor Materialisierung und erneut unmittelbar vor dem externen Publish werden Hash, Consent, Zielkonto und harte Policy-Grenzen geprüft. Bei Abweichung kehrt das Item nach `awaiting_approval` zurück und erhält ein neues Bundle.

## 10. Content-DNA-Vertrag

Die DNA darf folgende Stilmerkmale ableiten:

- Hook- und Opening-Muster
- Satz- und Absatzlängen
- Rhythmus und Interpunktion
- Person, Haltung und Direktheit
- Vokabular und unerwünschte Formulierungen
- Evidence- und CTA-Verhalten
- Narrative Arc und Strukturpräferenzen
- plattformspezifische Abweichungen

Die DNA darf niemals Fakten, Produktzahlen, Kundenbehauptungen, Consent oder rechtliche Aussagen erzeugen oder legitimieren.

Rohsamples werden nicht vollständig in jeden Prompt eingefügt. Die Generierung erhält das strukturierte Profil und höchstens zwei passend geretrievte Samples. Ein N-Gram- und Ähnlichkeitscheck verhindert wörtliches Kopieren.

Engagement-Gewinner werden nicht automatisch Golden Samples. Sie dürfen als Vorschlag erscheinen und benötigen eine bewusste Bestätigung.

## 11. Quality Gate und automatische Reparatur

Das bestehende Gate bleibt Grundlage und wird für den Writer erweitert:

- Proof Binding
- Resonanzstruktur
- deterministische Plattformregeln
- Selbstähnlichkeit
- DNA-/Creator-Fit
- Claim-Source-Binding
- Consent- und Quellenfrische
- Verbatim-Copying

Creator-Fit darf nur bei ausreichender DNA-Konfidenz hart blockieren. Andernfalls wird der Check sichtbar als `skipped` markiert. Ein übersprungener harter Sicherheitscheck ist niemals ein Pass.

Maschinenlesbare Remedies werden automatisch höchstens dreimal ausgeführt:

- kürzen
- unbelegte Aussage entfernen oder vorsichtig framen
- Struktur reparieren
- von eigenem früheren Content differenzieren
- CTA oder Plattformformat korrigieren

Danach wechselt der Vorschlag in „Benötigt Hilfe“ und verbraucht keine weiteren Credits.

## 12. Anti-Fabrication und Prompt-Injection

### 12.1 Claim-Source-Binding

Überprüfbare Claims werden typisiert erfasst:

- Claim-Typ
- Subjekt und Entität
- Aussage
- Kennzahl und Einheit
- Zeitraum
- Kontext
- exakter Quellenausschnitt
- Source-ID, Offset und Hash
- `verified_at`
- Consent-Status

Ein identischer Zahlenwert in einem sachfremden Proof ist kein Beleg. Variantenspezifische Claims dürfen ausschließlich an die `proof_asset_ids` der jeweiligen Variante gebunden werden.

### 12.2 Untrusted Content

Importierte Webseiten, Samples, Pillar-Texte, Feedback, Community-Inhalte und frühere Posts sind `UNTRUSTED_DATA`.

- Sie werden niemals in System- oder Developer-Instruktionen interpoliert.
- Eine erste Stufe extrahiert ausschließlich strukturierte Fakten mit Quelloffsets.
- Die Generierung sieht nur diese extrahierten Daten und ausdrücklich erlaubte Stilmerkmale.
- Rollenmarker, Tool-Aufrufe, „ignore previous instructions“, versteckter Text und codierte Anweisungen führen zur Quarantäne oder sichtbaren Warnung.

## 13. Fehler- und Recovery-Verhalten

- Temporäre AI- und Provider-Fehler erhalten begrenzte Retries mit Backoff.
- Nach drei Writer-Reparaturläufen entsteht eine Exception statt einer Endlosschleife.
- Ein Publish-Versuch erhält atomar eine Lease mit `attempt_id` und `lease_until`.
- Der externe Request wird von einem persistenten `attempt_started` begleitet.
- Bei „extern möglicherweise erfolgreich, lokale Bestätigung fehlt“ wechselt die Delivery in `unknown_external_state`.
- `unknown_external_state` wird niemals blind erneut publiziert.
- Teilpublikationen werden pro Kanal als `partially_published` sichtbar.
- Abgelaufene Approval-Bundles wechseln zu `expired` und müssen neu erzeugt werden.
- Widerrufener Consent, geänderte Quelle, geänderte Policy oder gelöschte Connection invalidiert das Bundle.
- Workspace-, Channel- und globaler Kill Switch stoppen neue Writer-Runs und noch nicht geclaimte Publikationen.
- Unbekannte Kapazität gilt als blockiert, nicht als unbegrenzt.
- Schema-Drift oder fehlende Migration pausiert den Writer mit `migration_pending` statt eines 500ers.

## 14. Lernen

Der Lernloop speichert:

- ursprünglichen Writer-Draft
- freigegebene Endfassung
- normalisierte Edit-Distanz
- strukturierte Edit-Kategorien
- Approval oder Ablehnung
- Ablehnungsgrund
- Gate-Findings und Remedies
- DNA-, Prompt-, Policy- und Gate-Version
- Veröffentlichungsergebnis
- reifes Outcome gegen die eigene Connection-Baseline

Lernbar sind:

- Topic- und Signalgewichtung
- Struktur- und Formatpräferenzen
- Hook- und Längenpräferenzen
- Kanal- und Slotgewichtung

Nicht lernbar sind:

- Fakten und Claims
- Consent
- rechtliche Freigaben
- Brand-Tabus
- Gate-Overrides
- Sicherheitsgrenzen

Schlechte Outcomes, Ablehnungen und starke Edits bleiben im Lernkorpus, damit kein Survivor Bias entsteht.

## 15. Rollout

### Phase 0 — Schema-Preflight und Integrität

- Live-Status der Migrationen `012`, `013`, `017`, `018` prüfen.
- SQL für `020_writer_integrity.sql` zeigen und explizit freigeben lassen.
- atomare Transition, Materialisierung und Publish-Claim implementieren.
- Concurrency- und Workspace-Isolationstests bestehen.

### Phase 1 — Content DNA

- SQL für `021_content_dna.sql` zeigen und explizit freigeben lassen.
- Sample CRUD, Duplicate Guard und DNA-Rebuild implementieren.
- Writer-Unteransicht „Content DNA“ aktivieren.
- DNA zunächst nur anzeigen und in Evals verwenden.

### Phase 2 — Writer Review Inbox

- SQL für `022_writer_pilot.sql` zeigen und explizit freigeben lassen.
- Review Bundle, Snapshot Hash und Approval Endpoint implementieren.
- Writer-Reiter und „Heute“-Ansicht aktivieren.
- Runs bleiben manuell ausgelöst.

### Phase 3 — Shadow Mode

- Writer erzeugt Vorschläge bis `awaiting_approval`.
- „Freigeben“ materialisiert noch nicht; die UI markiert Shadow-Ergebnisse.
- Prompt-, Gate-, Exception- und Kostenmetriken werden geprüft.

### Phase 4 — Approval-required Canary

- ausschließlich der bestätigte Workspace wird aktiviert.
- „Freigeben & einplanen“ materialisiert und plant atomar.
- täglicher Worker wird mit Daily Cap und Credit Cap aktiviert.
- alle bestehenden Flows bleiben parallel verfügbar.

### Phase 5 — Pilotbewertung

- Bewertung nach mindestens 20 Posts.
- Metriken, Ablehnungsgründe, Edits und Exceptions werden ausgewertet.
- Erst danach fällt eine neue Produktentscheidung über Default-Navigation, weitere Automation oder Übernahme in bestehende Flows.

## 16. Tests

### 16.1 Unit-Tests

- DNA-Konfidenz und Cold-Start-Grenzen
- Sample-Deduplizierung und Hashing
- Generation-Context-Auflösung
- Policy- und Credit-Caps
- Snapshot-Hashing und Invalidierung
- State-Transition-Matrix
- Auto-Repair-Budget
- Edit-Distanz und Lernkategorien

### 16.2 DB-Integration

- State und Audit rollen gemeinsam zurück
- parallele Transitions gewinnen exakt einmal
- Materialisierung ist atomar und idempotent
- ein Variant erzeugt höchstens ein Post Item
- genau ein Publish-Claim-Winner bei 100 parallelen Events
- RLS und Service-Role-Queries isolieren Workspaces
- Slot-Reservierung erzeugt keine Konflikte

### 16.3 Security-Tests

- Snapshot-Manipulation jedes einzelnen gebundenen Feldes blockiert
- Consent-Widerruf zwischen Approval und Publish blockiert
- Rollenmatrix für Viewer, Member, Admin und Owner
- API-Keys und MCP können im Pilot nicht freigeben
- Prompt-Injection-Corpus über Samples, URLs, Pillar, Feedback und frühere Posts
- kontextuell falsche Zahlen-, Entitäts-, Einheits- und Zeitraum-Bindung blockiert
- wörtliches Kopieren aus Samples blockiert

### 16.4 E2E

```text
Golden Sample
  -> DNA Profile
  -> Writer Run
  -> Gate + Repair
  -> Review Bundle
  -> User Approval
  -> post_group/post_items
  -> Publisher Mock
  -> Metrics
  -> measured
  -> Learning Event
```

Der E2E-Test prüft außerdem Änderung, Ablehnung, abgelaufene Freigabe, Teilfehler und Kill Switch.

## 17. Datenschutz

- Samples, DNA-Profile, Policies, Review-Bundles und Lernereignisse werden in GDPR-Export und Workspace-Löschung aufgenommen.
- Proofs werden vor Model-Calls auf Consent und Datenminimierung geprüft.
- Kunden- oder Personenzitate ohne passende Freigabe blockieren.
- Rohsamples werden nicht workspace-übergreifend genutzt.
- Cross-Workspace-Learning ist im Pilot ausgeschlossen.

## 18. Deployment und bestehender Arbeitsbaum

Der aktuelle `main`-Arbeitsbaum enthält uncommitted Community-/Discovery-Arbeiten sowie Migration `019_community_membership.sql`. Diese Änderungen gehören nicht zum Writer-Pilot und werden nicht überschrieben, zurückgesetzt oder stillschweigend in Writer-Commits aufgenommen.

Writer-Commits werden dateigen und reviewbar gehalten. Vor dem finalen Push wird geklärt, welche bereits vorhandenen uncommitted Änderungen Bestandteil des Deployments sein sollen. Der Writer wird erst nach vollständigem Typecheck, Test-Suite, Build, DB-Preflight und Vercel-Preview-Verifikation auf `main` gepusht. Der Production-Deployment-Status wird anschließend über Vercel geprüft.

## 19. Abnahmekriterien

Der Writer-Pilot gilt als implementiert, wenn:

1. der zusätzliche `Writer`-Reiter existiert und alle bestehenden Reiter unverändert erreichbar bleiben;
2. der Writer standardmäßig pausiert ist;
3. Golden und Avoid Samples verwaltet werden können;
4. ein versioniertes DNA-Profil mit Konfidenz entsteht;
5. ein Writer-Run ohne Nutzerinput genau einen Vorschlag bis `awaiting_approval` erzeugt;
6. alle ausgewählten Kanalvarianten harte Gates bestehen oder das Bundle blockiert wird;
7. die Review-Karte vollständige Ziele, Zeiten, Quellen, Warnungen und Varianten zeigt;
8. eine persönliche Einzelfreigabe erforderlich ist;
9. jede gebundene Änderung die Freigabe invalidiert;
10. die Freigabe atomar echte `post_groups/post_items` erzeugt und einplant;
11. parallele Events keinen Doppelpost erzeugen;
12. Fehler und Teilpublikationen sichtbar und recoverable sind;
13. Edits, Ablehnungen und reife Outcomes als kontrollierte Lernsignale gespeichert werden;
14. GDPR-Export und Löschung alle Writer-Daten abdecken;
15. alle definierten Unit-, Integrations-, Security- und E2E-Tests grün sind;
16. der Vercel-Production-Deployment nach Push auf `main` erfolgreich und geprüft ist.
