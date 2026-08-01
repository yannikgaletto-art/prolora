# Golden Samples, Facts Timeline und Narrative QA

**Datum:** 2026-08-01
**Status:** Vom Nutzer grundsätzlich freigegeben; schriftliche Endprüfung ausstehend
**Produkt:** Prolora Writer und alle nutzerseitigen Textgenerierungsflüsse

## 1. Ziel

Prolora soll aus kuratierten Golden Samples eigenständig neue, plattformgerechte Inhalte erzeugen, ohne Formulierungen oder Fakten aus den Samples zu kopieren. Vor jeder manuellen Generierung entscheidet der Nutzer, ob Deutsch, Englisch oder beide Sprachen erzeugt werden. Prolora entscheidet außerdem nachvollziehbar, ob ein Pathly-Verweis zum Thema, zur Plattform und zur bisherigen Veröffentlichungsfolge passt.

Ein Narrative Judge prüft jeden Entwurf vor der Freigabe gegen bestätigte Fakten, ihre zeitliche Gültigkeit und bereits veröffentlichte Aussagen. Zahlen, Produktzustände, Schulden, Umsätze und andere überprüfbare Behauptungen dürfen ausschließlich aus einem manuell bestätigten Facts-&-Timeline-Ledger stammen.

Das System soll viele eigenständige Varianten ermöglichen. Es verspricht keine mathematisch unendliche Menge semantisch verschiedener Aussagen. Es verhindert jedoch einen endlichen Vorlagenkatalog, indem Stil, Thema, Blickwinkel, Hook, Dramaturgie, Plattformform und CTA unabhängig kombiniert und Wiederholungen geprüft werden.

## 2. Nicht-Ziele

- Keine vollautomatische externe Veröffentlichung ohne bestehende menschliche Freigabe.
- Keine Übernahme von Zahlen oder Produktbehauptungen aus Golden Samples.
- Kein automatisches Bestätigen neuer Fakten aus einem Modelloutput.
- Kein Cross-Workspace-Lernen oder Teilen persönlicher Samples.
- Keine Garantie, dass ein begrenzter Fakten- und Themenbestand unendlich viele inhaltlich neue Aussagen trägt.
- Keine Umgehung von Plattformregeln oder Community-Werbeverboten.

## 3. Ausgangslage

Im Repository liegen zwölf nutzereigene Golden Samples in vier Kategorien:

- `golden-samples/polarisierung.md`
- `golden-samples/inside-the-room.md`
- `golden-samples/failure-und-learning.md`
- `golden-samples/mission-und-gemeinwohl.md`

Die bestehende Content DNA speichert Golden und Avoid Samples, analysiert jedoch nur Golden Samples. Der Writer lädt aktuell nur Profil-ID und Version; Prompt-Regeln und passende Samples erreichen Konzept- und Variantengenerierung nicht. Plattformsegmentierung, deutschsprachige Stilmerkmale, Sample-Retrieval, Creator-Fit und Verbatim-Copying sind unvollständig oder fehlen.

Proof Assets sichern heute einzelne Produktbehauptungen ab, bilden aber noch keine versionierte Narrative oder Gültigkeitszeiträume ab. Die veröffentlichte Historie liegt bereits in `content_items`, `content_item_variants`, `post_groups` und `post_items`; sie wird weiterverwendet und nicht in einer konkurrierenden Claim-Datenbank dupliziert.

### 3.1 Passung in das bestehende Ökosystem

Diese Erweiterung vervollständigt die bereits geplante Writer-Architektur. Sie ersetzt keinen bestehenden Kernbaustein:

| Bestehender Baustein | Bleibt verantwortlich für | Gezielte Erweiterung |
|---|---|---|
| Produktprofil + Proof Vault | Produktkontext, Belege, Consent | strukturierte, zeitlich gültige Facts im bestehenden `proof_assets`-Bestand |
| Proof Suggestions | unbestätigte, maschinell erkannte Belege | vorgeschlagene Facts aus Drafts und Quellen bis zur menschlichen Entscheidung |
| Content DNA | Golden/Avoid Samples, Profilversion, Konfidenz | Bundle-Import, Maskierung, DE/EN-Analyse, Plattform-Retrieval |
| Concept Service | Idee und drei Lenses | explizite Sprache, DNA-Kontext und strukturierte Pathly-Entscheidung |
| Channel-Native Service | eigenständige Fassung pro Kanal | Facts-Snapshot, Sprache, Mention-Entscheidung und Sample-Kontext |
| Content Factory | Zustände, Varianten, Übergänge | keine neue Zustandsmaschine; QA-Ergebnisse bleiben am Werkstück und Variant |
| Quality Gate | Proof Binding, Struktur, Plattform, Ähnlichkeit | Narrative-, Sprach-, Mention- und Sample-Copying-Checks |
| Writer Repair Loop | maximal drei Reparaturen | zusätzliche maschinenlesbare Narrative-Remedies |
| Review Bundle | unveränderlicher Freigabe-Snapshot | Facts-, Sample-, Sprach- und Mention-Hashes ergänzen |
| Materialisierung | atomare Übergabe an `post_groups`/`post_items` | QA-Kontext an das erzeugte `post_item` weiterreichen |
| Publisher | technische Veröffentlichung | gemeinsame QA-Freshness-Precondition vor dem externen Call; keine eigene KI- oder Narrative-Logik |
| Post-Historie | veröffentlichte Texte und Zeitpunkte | Quelle für Verlauf, Mention-Cadence und Konsistenzprüfung |

Der in der Writer-Spezifikation bereits vorgesehene gemeinsame Kontext-Resolver wird nun tatsächlich umgesetzt. Damit verwenden Concept Service, Channel-Native Service, Template Drafting, Splinter, Reuse und Quality Gate dieselbe Kontextquelle, statt jeweils eigene Prompt-Abkürzungen zu pflegen.

## 4. Verbindliche Prinzipien

### 4.1 Stil und Wahrheit bleiben getrennt

Golden Samples sind ausschließlich Stilquellen. Vor Prompt-Nutzung werden folgende Inhalte maskiert:

- Zahlen, Prozentwerte, Währungen und Zeiträume;
- `[X]`- und andere Platzhalter;
- Namen, Links und konkrete Produktzustände;
- Nutzer-, Umsatz-, Funding-, Kosten-, Schulden- und Conversion-Behauptungen;
- konkrete Kundenzitate, sofern sie nicht zusätzlich als freigegebener Proof vorliegen.

Die Generierung erhält den maskierten Text und strukturierte Stilmerkmale. Sie erhält niemals die Anweisung, Sample-Fakten zu übernehmen.

### 4.2 Der Facts Ledger ist die einzige Faktenquelle

Jede überprüfbare Behauptung benötigt einen bestätigten Ledger-Eintrag oder ein weiterhin gültiges Proof Asset. Ein fehlender Fakt führt zu einer Formulierung ohne konkrete Behauptung oder zum Status `needs_input`; niemals zu einer Schätzung.

### 4.3 Plattformen erhalten eigenständige Artefakte

LinkedIn-, X-, Reddit-, Mastodon-, Bluesky-, Telegram- und weitere Fassungen werden aus derselben Idee jeweils neu geschrieben. Eine Plattformfassung ist nicht die gekürzte Version einer anderen.

### 4.4 Qualität wird vor Freigabe geprüft

Ein Entwurf erreicht `awaiting_approval` nur, wenn alle harten Fakten-, Sprach-, Plattform- und Konsistenzprüfungen bestanden wurden. Weiche Stilprüfungen dürfen sichtbar übersprungen werden, wenn die benötigte Infrastruktur fehlt. Harte Faktenprüfungen dürfen nicht als bestanden markiert werden, wenn sie nicht liefen.

## 5. Nutzerablauf

### 5.1 Generierungs-Preflight

Vor einer nutzergestarteten Generierung zeigt Prolora drei verpflichtende Sprachoptionen:

- Deutsch
- English
- Beide

Die Auswahl gehört zum Generierungsauftrag und wird im Review-Snapshot gespeichert. `Beide` erzeugt je Zielplattform zwei getrennte Varianten.

In der Content Factory bedeutet `Beide` nicht zwei Sprachvarianten am selben Kanal-Werkstück: Die vorhandene Invariante „ein Artefakt pro Kanal und Content Item“ bleibt erhalten. Stattdessen entstehen zwei sprachlich getrennte, miteinander gruppierte Content Items. Dadurch bleiben Approval, Scheduling, Frequenz-Caps und Publishing pro tatsächlichem Post eindeutig.

Zusätzlich zeigt der Preflight die Pathly-Policy:

- `Adaptiv` — Prolora entscheidet und begründet;
- `Erwähnen` — nur zulässig, wenn Regeln und Fakten es erlauben;
- `Nicht erwähnen` — harte Unterdrückung jedes Produktverweises.

Der Standard ist `Adaptiv`. Ein nutzerseitiges `Erwähnen` darf Community-Regeln oder fehlende Fakten nicht überstimmen.

### 5.2 Facts-&-Timeline-Verwaltung im bestehenden Produktprofil

Der Facts Ledger wird als zusätzlicher Bereich des bestehenden Product Profiles und Proof Vaults umgesetzt, nicht als paralleles Einstellungsprodukt. Owner und Admins können dort Fakten anlegen, bestätigen, korrigieren und zeitlich einordnen. Beispiele:

- `product.status = active`
- `users.active = 68`, gültig ab 2026-07-01
- `users.active = 100`, gültig ab 2026-07-15
- `funding.raised_eur = 0`
- `ai_cost.monthly_eur = 1280`, historischer Höchststand für einen bezeichneten Monat
- `debt.current_eur = 0`

Ein Fakt besitzt mindestens Subjekt, Prädikat, typisierten Wert, Einheit, `effective_from`, optional `effective_to`, Aussageart, Status und Quellenhinweis. Aussagearten sind:

- `current_state`
- `historical_state`
- `event`
- `metric`
- `financial`
- `policy`

Neue oder aus Entwürfen erkannte Fakten landen als unbestätigte Vorschläge. Nur eine explizite Nutzeraktion aktiviert sie.

### 5.3 Review

Die Freigabeansicht zeigt:

- gewählte Sprache;
- Pathly-Entscheidung mit Begründung;
- verwendete Golden Samples, nur als Stilquellen;
- gebundene Fakten mit Gültigkeitszeitpunkt;
- Narrative-Judge-Ergebnis;
- Ähnlichkeit zu Samples und jüngsten Posts;
- Reparaturen, Warnungen und übersprungene weiche Checks.

## 6. Datenmodell

Eine neue, repository-only Migration erweitert vorhandene Tabellen additiv. Es entsteht keine parallele Content- oder Claim-Datenbank.

### 6.1 `content_samples`

Zusätzliche Felder:

- `category TEXT`
- `hook_type TEXT`
- `content_format TEXT`
- `masked_content TEXT`
- `metadata JSONB`

Bestehende Felder `platform`, `kind`, `origin`, `content_hash` und `embedding` bleiben erhalten. Der Rohtext bleibt für Analyse und UI verfügbar; Prompts verwenden standardmäßig `masked_content`.

### 6.2 `proof_assets` als Facts Ledger

Der bestehende Proof Vault bleibt die Anti-Fabrikationsquelle. Strukturierte Facts werden als zusätzliche, optionale Felder am bestehenden Asset modelliert:

- `fact_key TEXT`, zum Beispiel `pathly.users.active`;
- `fact_kind TEXT`: `current_state`, `historical_state`, `event`, `metric`, `financial`, `policy`;
- `fact_value JSONB` und `fact_unit TEXT`;
- `effective_from TIMESTAMPTZ`, `effective_to TIMESTAMPTZ`;
- `fact_status TEXT`: `confirmed`, `superseded`, `revoked`;
- `direction_policy TEXT`: `free`, `warn_on_decrease`, `warn_on_increase`;
- `fact_change_reason TEXT`, verpflichtend, wenn ein neuer Wert entgegen der Richtungs-Policy läuft;
- `supersedes_proof_asset_id UUID`;
- `confirmed_by UUID`.

`verified_at` bleibt der Bestätigungszeitpunkt. `consent_status` regelt weiterhin die Nutzung von Kundenbehauptungen, Zitaten und anderen Drittbelegen; interne Produkt- und Finanzfakten erhalten dadurch keine künstliche Consent-Bedeutung. Bestehende unstrukturierte Proof Assets bleiben vollständig kompatibel. Sie belegen weiterhin einzelne Aussagen, zählen aber erst nach expliziter Strukturierung als zeitlicher Fact.

Für einen aktuellen Zeitpunkt darf pro Workspace und `fact_key` höchstens ein bestätigter aktueller Fact wirksam sein. Korrekturen supersedieren alte Einträge, löschen sie aber nicht. Die bestehende DELETE-Route bleibt für gewöhnliche Proof Assets erhalten; bestätigte strukturierte Facts dürfen nur supersediert oder widerrufen werden.

Die bisherige feste Listenbegrenzung von 50 Proof Assets wird nicht auf die gesamte Facts-Historie übertragen. Das Product Profile lädt gewöhnliche Proofs, aktive Facts und historische Facts paginiert beziehungsweise getrennt; Prompt-Retrieval erhält weiterhin nur die wenigen für den Auftrag relevanten Einträge.

### 6.3 `proof_suggestions` für unbestätigte Facts

Die bereits vorhandene Vorschlags-Inbox bleibt die Grenze zwischen Modellfund und bestätigter Wahrheit. Sie erhält additive Felder:

- `suggestion_origin TEXT`: `feedback`, `draft`, `manual`;
- `fact_payload JSONB` mit vorgeschlagenem `fact_key`, Typ, Wert, Einheit, Gültigkeit, Richtungs-Policy und Quellenhinweis;
- `source_content_item_variant_id UUID`, falls der Vorschlag aus einem Entwurf stammt.

Ein Vorschlag darf nie als Claim-Binding dienen. Erst die vorhandene Accept-Entscheidung durch Owner/Admin erzeugt atomar das strukturierte `proof_asset`, schließt gegebenenfalls den vorherigen Gültigkeitszeitraum und setzt den Vorschlag auf `accepted`. Eine Ablehnung bleibt als `rejected` nachvollziehbar. Ein Modell kann diesen Übergang nicht auslösen.

### 6.4 Bestehende Content-Historie statt neuer Claim-Tabelle

Claim-Bindings und Judge-Findings werden in bereits vorhandenen Strukturen gespeichert:

- `content_item_variants.gate_result` enthält Bindings, Facts-Snapshot, Mention-Entscheidung und Judge-Version;
- `writer_review_bundles.snapshot` bindet die exakten Facts und Samples per Hash;
- `post_items` erhält ein additives `qa_context JSONB`, damit auch nicht aus dem Writer stammende KI-Posts ihren geprüften Kontext behalten. Es enthält mindestens Generierungsherkunft, Sprache, Content-Hash, Gate-Status, Facts-/Sample-Hashes, normalisierte Claim-Bindings und Judge-Version;
- `post_items.content_item_variant_id` verbindet Writer-Posts bereits mit ihrer geprüften Variante;
- `post_items.resolved_content` und `published_at` bleiben die kanonische veröffentlichte Text-Historie.

Damit kann der Judge frühere Aussagen und zeitliche Reihenfolgen aus der echten Veröffentlichungshistorie rekonstruieren. Es gibt keine zweite Tabelle, deren Zustand von den veröffentlichten Posts wegdriften könnte.

### 6.5 Sprachgeschwister in `content_items`

Die bestehende Factory-Invariante `UNIQUE (content_item_id, channel_key)` bleibt unverändert. Für einen zweisprachigen Auftrag erhält `content_items` stattdessen:

- `language TEXT`, für neue Generierungen verpflichtend mit `de` oder `en`, bei historischen Zeilen notfalls `NULL`;
- `generation_group_id UUID`, das die deutschen und englischen Geschwister desselben Auftrags verbindet.

Der vorhandene partielle Idempotenz-Index auf `workspace_id + signal_ref` wird auf `workspace_id + signal_ref + language` erweitert. Historische Zeilen werden nur dann zurückgefüllt, wenn ihre Sprache zuverlässig bestimmbar ist; sie werden nicht pauschal als deutsch umetikettiert. Signal-Auswahl und Writer-Idempotenz prüfen anschließend das Paar aus Signal und Sprache. So kann dasselbe Signal genau einmal pro gewünschter Sprache verarbeitet werden, ohne `channel_key` zweckzuentfremden.

### 6.6 `workspace_writer_policies`

Der bestehende Writer-Policy-Datensatz erhält:

- `output_languages TEXT[]`, zulässig sind `de` und `en`;
- `product_mention_mode TEXT`, zulässig sind `adaptive`, `include`, `exclude`.

Diese Felder lösen den Sonderfall des automatischen Writers: Ein Hintergrundlauf kann keine Rückfrage anzeigen und verwendet deshalb die zuvor ausdrücklich gespeicherte Policy. Bei manuellen Flows bleibt die Auswahl pro Generierungsauftrag verpflichtend.

Alle Service-Role-Zugriffe werden explizit mit `workspace_id` gescopet. Sensible Tabellen verwenden Spalten-Allowlists statt `select('*')`. Neue Row-Types bleiben zunächst lokal in den zuständigen Modulen, damit die bereits vorhandenen, nicht committeten Änderungen an `lib/db.ts` nicht überschrieben werden. Schemaänderungen werden nicht live angewendet, bevor der Nutzer das bestehende Migration-STOP-Gate separat freigibt.

Die Migration verwendet bei der Umsetzung die dann nächste freie Nummer. Sie nimmt insbesondere keine Nummer vorweg, die bereits in den nicht committeten Discovery-Arbeiten belegt ist.

## 7. Golden-Sample-Pipeline

### 7.1 Import des kuratierten Bundles

Die zwölf Markdown-Abschnitte werden als versioniertes Prolora-Bundle erfasst. Ein Owner/Admin kann dieses Bundle einmalig in den eigenen Workspace importieren. Der Import ist idempotent über `kind + content_hash`.

Jedes Sample erhält:

- Kategorie;
- Plattform;
- Hook-Typ;
- Format;
- Rohtext;
- maskierten Stiltext;
- Herkunft `imported`;
- Bundle-Version.

Der Import bestätigt keine im Text enthaltenen Fakten.

Der DNA-`sample_set_hash` berücksichtigt künftig neben `kind + content_hash` auch die promptrelevanten Metadaten und den Hash von `masked_content`. Eine Änderung an Plattform, Kategorie, Hook, Maskierung oder Aktivstatus erzeugt deshalb zuverlässig eine neue immutable DNA-Version.

### 7.2 Mehrsprachige DNA

Die deterministische Analyse wird für Deutsch und Englisch erweitert:

- Ich-/Wir-Perspektive;
- CTA-Muster;
- Opening-Formen;
- Satz- und Absatzlänge;
- Fragen, Interpunktion und Whitespace;
- Listen- und Thread-Struktur;
- wiederkehrende Übergänge und Schlussformen;
- Avoid-Muster als negative Regeln.

Plattformprofile werden getrennt berechnet, sofern genug Material vorliegt. Bei zu wenig plattformspezifischem Material greift das globale Profil mit geringer ausgewiesener Konfidenz.

### 7.3 Retrieval und Neuartigkeit

Pro Entwurf werden höchstens zwei Samples abgerufen. Ranking:

1. gleiche Plattform;
2. passende Kategorie und Hook-Familie;
3. semantische Nähe zum Thema;
4. aktive, bestätigte Golden-Sample-Kennzeichnung;
5. Diversität gegenüber kürzlich verwendeten Samples.

Wenn kein Embedding-Anbieter konfiguriert ist, verwendet Prolora ein deterministisches Metadaten-Ranking. Die Generierung darf deshalb weiterlaufen; der semantische Ähnlichkeitscheck wird sichtbar als `skipped` markiert.

Sample-N-Gramme, exakte Sätze und Embedding-Ähnlichkeit werden gegen den Output geprüft. Ein zu ähnlicher Entwurf wird höchstens dreimal mit einem anderen Winkel repariert und danach als `needs_input` gestoppt.

## 8. Pathly-Erwähnungsentscheidung

Ein separater, strukturierter Schritt erzeugt vor dem Schreiben:

- `decision`: `include` oder `omit`;
- `reason`;
- `placement`: Haupttext, Schluss, Kommentar oder nicht anwendbar;
- `confidence`;
- verwendete Regeln und Fakten.

Entscheidungsfaktoren:

- Thema und Content-Ziel;
- Golden-Sample-Kategorie;
- Plattform und Community-Regeln;
- Anteil der jüngsten veröffentlichten Posts mit Pathly-Erwähnung;
- ob Pathly für die Aussage substanziell relevant ist;
- ob eine belegbare Produktbehauptung verfügbar ist;
- Werbeintensität der geplanten Formulierung.

Reddit und werbekritische Communities verwenden standardmäßig `omit`, sofern Pathly nicht für die Antwort erforderlich und laut Regeln zulässig ist. Ein Produktverweis darf nie nachträglich in eine bereits bestandene Community-Antwort geschoben werden, ohne die Compliance-Prüfung erneut auszuführen.

## 9. Gemeinsamer Plattform- und Sprachkontext

Der in der bestehenden Writer-Spezifikation bereits vorgesehene `loadGenerationContext(workspaceId)` wird zum gemeinsamen `GenerationContextResolver` ausgebaut. Writer, Templates, Compose-Adaption, Splinter, Reuse und Community-Drafts rufen ihn mit Auftrag, Sprache, Zielplattform, `as_of` und Mention-Policy auf. Er enthält:

- `language`: `de` oder `en`;
- Zielplattform und Format;
- maskierte DNA-Regeln und maximal zwei Samples;
- Facts-Snapshot mit `as_of`;
- Pathly-Entscheidung;
- Proof Assets;
- die kanonische veröffentlichte Post-Historie und Ähnlichkeitskontext;
- Prompt- und Policy-Version.

Für `Beide` wird der Kontext zweimal erstellt. Die englische Fassung ist keine Übersetzung der deutschen Fassung; beide werden aus derselben Idee und demselben Facts-Snapshot plattformnativ erzeugt.

Plattformregeln werden nicht neu als Prompttext dupliziert. Der Resolver verwendet die vorhandenen Quellen `PLATFORM_NOTES`, `getPlatformRules()` sowie – für Community-Flows – die bestehenden Connection-/Provider-Deskriptoren und Community-Regeln. Die folgenden Eigenschaften sind damit Produktanforderungen an diese vorhandenen Regeln:

- **LinkedIn:** mittlere bis längere Narrative, klare Absätze, ein dominanter Gedanke, sparsame CTA.
- **X:** Single Post oder expliziter Thread, kurze Segmente, keine künstliche LinkedIn-Zeilenästhetik.
- **Reddit:** ausführlicher Kontext, glaubwürdige Selbstkritik, Community-Regeln, keine verdeckte Werbung.
- **Mastodon:** sachlich, dialogisch, ohne Growth-Hacks und aggressive CTA.
- **Bluesky:** kompakt, gesprächsnah, eigenständige kurze Fassung.
- **Telegram:** längere, direkt lesbare Fassung mit klarer Struktur und ohne Feed-Hook-Zwang.
- **Discord:** kanal- und communitynah, direkt, ohne künstlichen Feed-Hook; bestehende Server-/Channel-Regeln haben Vorrang.
- **Dev.to:** eigenständiger, strukturierter Fachartikel mit belastbarem Titel, Zwischenüberschriften und nachvollziehbarem Learning.
- **Hashnode:** eigenständiger technischer Longform-Artikel; kein aufgeblähter LinkedIn-Post und keine ungeprüften Code- oder Performance-Behauptungen.

Reddit und weitere Discovery-Ziele werden über ihre vorhandenen Community-/Provider-Regeln behandelt, auch wenn sie keine direkt publishbare `PlatformType` sind. Gibt es für eine Plattform noch keine eigenen Golden Samples, greift die globale DNA mit sichtbar geringerer Konfidenz; Prolora erfindet dafür kein vermeintlich gelerntes Plattformprofil.

`generateChannelNativeVariants()` bleibt für inhaltlich eigenständige Plattformartefakte verantwortlich. Die vorhandenen Adapter und Validatoren sichern anschließend technische Limits. Inhaltlich fertige Varianten werden nicht durch generische Plattformkürzung ersetzt.

## 10. Narrative Judge als Erweiterung des Quality Gates

`runQualityGate()` bleibt der einzige Quality-Gate-Einstieg. Der Narrative Judge wird darin als zusätzliche Gruppe deterministischer und semantischer Checks ausgeführt. Er läuft nach der Generierung und nach jeder manuellen Textänderung; es entsteht kein zweites konkurrierendes Gate.

Der geprüfte Content-Hash wird im Review-Snapshot beziehungsweise in `post_items.qa_context` gespeichert. Alle Übergänge in einen veröffentlichbaren Zustand – Writer-Materialisierung, `createPost`, Schedule, Publish-now und Bulk-Import, sofern der Inhalt als KI-generiert markiert ist – prüfen, dass Hash, Gate-Version und Facts-Snapshot aktuell und bestanden sind. Direkt vor dem externen Plattform-Call läuft dieselbe kostengünstige Freshness-Precondition nochmals, ohne einen neuen LLM-Call auszulösen. Ein manuell veränderter oder durch neue Facts veralteter KI-Entwurf kann deshalb nicht über einen alternativen Publish-Pfad am Gate vorbeigeschoben werden. Rein manuell verfasste Posts ohne KI-Herkunft bleiben von dieser zusätzlichen Pflicht ausgenommen.

### 10.1 Deterministische harte Checks

- Sprache entspricht dem Auftrag.
- Plattform- und Segmentlimits stimmen.
- Jede Zahl, Währung, Prozentangabe, Zeitdauer und überprüfbare Produktbehauptung besitzt ein Fact-/Proof-Binding.
- Der gebundene Fakt war zum `as_of`-Zeitpunkt gültig.
- Aktuelle Aussagen verwenden den neuesten bestätigten Fakt.
- Historische Werte sind sprachlich als historisch erkennbar.
- Zeitliche Reihenfolge und `direction_policy` werden eingehalten; ein Richtungsbruch verlangt einen ausdrücklich bestätigten neuen Fakt samt Begründung und darf nicht stillschweigend aus einem Modelloutput entstehen.
- Pathly erscheint genau entsprechend der erlaubten Mention-Entscheidung.
- Verbotene Claims oder ungefüllte Platzhalter erscheinen nicht.
- Exakte bzw. nahezu exakte Sample-Übernahme wird blockiert.

### 10.2 Strukturierter semantischer Judge

Ein LLM-gestützter, per Tool-Schema erzwungener Check bewertet:

- qualitative Widersprüche zu bestätigten Zuständen;
- falsche zeitliche Implikationen;
- Widersprüche zur jüngsten veröffentlichten Narrative;
- roter Faden zwischen Problem, Learning, aktuellem Zustand und CTA;
- unpassende Produktwerbung;
- Creator-Fit und Plattformnatürlichkeit.

Das Modell darf nur Findings melden. Es entscheidet nicht über die Wahrheit und kann keinen Fakt bestätigen.

### 10.3 Reparatur

Maschinenlesbare Remedies werden höchstens dreimal angewendet:

- Zahl entfernen oder an bestätigten Fakt binden;
- Gegenwart in historische Form ändern;
- widersprüchlichen Zustand korrigieren;
- Pathly-Verweis entfernen oder zulässig platzieren;
- Plattformstruktur reparieren;
- Sprache korrigieren;
- Sample-Ähnlichkeit durch neuen Winkel reduzieren.

Nach drei Fehlversuchen bleibt der Entwurf im bestehenden Zustand `drafted`. `gate_result` enthält ein blockierendes Finding mit `resolution: needs_input`; die bestehende Factory-State-Machine wird nicht um einen Sonderzustand erweitert. Es entstehen keine weiteren Modellkosten, bis der Nutzer Fakten ergänzt oder den Entwurf ändert.

## 11. Integration in vorhandene Flows

Die zentrale Kontext- und Judge-Schicht wird schrittweise an folgende vorhandene Flows angeschlossen:

1. **Writer:** `concept-service`, `generateChannelNativeVariants()`, der vorhandene dreistufige Repair-Loop, Review Bundle und Materialisierung erhalten denselben Kontext-Snapshot.
2. **Publish Start, Templates und Composer:** `StartFlow`, `TemplateGuide` und `PostComposer` verwenden einen gemeinsamen Generierungs-Preflight. Die Dashboard-Locale bleibt reine UI-Sprache und wird nicht länger implizit als Ausgabesprache behandelt.
3. **Pillar/Splinter und Reuse:** bestehende Plattformregeln und veröffentlichte Posts bleiben erhalten; hinzu kommen Sample-Retrieval, Facts-Snapshot und erneutes Gate.
4. **Discovery/Community:** vorhandene Voice-Konfiguration, Response Map und Compliance-Prüfung bleiben zuständig. Persönliche Samples werden nur für nutzerseitige Drafts genutzt; eine Pathly-Erwähnung löst die bestehende Compliance-Prüfung erneut aus.
5. **Changelog:** nutzt denselben Fakten- und Sprachkontext, aber standardmäßig ein sachliches DNA-Teilprofil ohne persönliche Failure-Dramaturgie.

Die Sprach- und Mention-Auswahl wird als wiederverwendbarer Preflight-Baustein umgesetzt, damit manuelle Flows dieselben Felder, Defaults und Validierungen verwenden. Der automatische Writer bezieht dieselben Entscheidungen aus `workspace_writer_policies`, weil ein Hintergrundlauf keine Rückfrage stellen kann.

Analytische Flows wie Feedback-Klassifikation, Community-Ranking und interne Executive Summaries verwenden keine persönlichen Golden Samples.

Die bestehenden, nicht committeten Discovery-Arbeiten bleiben erhalten. Überschneidende Dateien werden chirurgisch ergänzt; keine fremden Änderungen werden zurückgesetzt oder pauschal formatiert.

## 12. Fehlerverhalten

- Kein bestätigter Fakt für eine gewünschte Zahl: Zahl auslassen oder `needs_input`.
- Widersprüchliche bestätigte Fakten: Generierung blockieren und Admin-Korrektur verlangen.
- Fehlender Embedding-Anbieter: Metadaten-Retrieval; Ähnlichkeitscheck sichtbar übersprungen.
- Fehlender LLM-Anbieter: keine neue Generierung; gespeicherte Inhalte bleiben verfügbar.
- Judge-Timeout: harte lokale Checks bleiben maßgeblich, semantischer Check gilt nicht als bestanden; Writer stoppt vor Freigabe.
- Community-Regeln unbekannt: Pathly standardmäßig nicht erwähnen und Warnung anzeigen.
- Facts ändern sich nach Review: Snapshot-Prüfung invalidiert die Freigabe und erzeugt einen neuen Review-Durchlauf.

## 13. Sicherheit und Datenschutz

- Sample-, Fact- und QA-Kontextdaten bleiben workspace-isoliert.
- Sample-Inhalte, importierte URLs und frühere Posts werden als nicht vertrauenswürdige Daten behandelt, nicht als Systemanweisungen.
- Fakten-Snapshots werden gehasht und an Review/Approval gebunden.
- Die neuen Felder der bestehenden Tabellen werden in GDPR-Export und Workspace-Löschung aufgenommen.
- Kundenbehauptungen und Zitate benötigen weiterhin Consent und Proof-Binding.
- API-Keys dürfen Facts lesen, aber nicht bestätigen; Bestätigung bleibt sessiongebunden für Owner/Admin.

## 14. Tests und Abnahme

### 14.1 Golden Samples

- alle zwölf Samples werden idempotent importiert;
- Zahlen und Platzhalter sind im Prompttext maskiert;
- Plattform-, Kategorie- und Hook-Metadaten bleiben erhalten;
- deutsche und englische DNA-Merkmale funktionieren;
- Avoid Samples erzeugen negative Regeln;
- höchstens zwei Samples gelangen in einen Prompt.

### 14.2 Facts und Timeline

- unbestätigte Fakten können keine Claims legitimieren;
- `68` am früheren und `100` am späteren Zeitpunkt ist zulässig;
- `68` als aktueller Stand nach bestätigten `100` wird blockiert;
- ein historischer Verweis auf `68` bleibt mit klarer Zeitform zulässig;
- ein Rückgang entgegen der Richtungs-Policy ist nur als ausdrücklich bestätigter neuer Fakt mit Begründung und passender zeitlicher Einordnung zulässig;
- Schulden-, Funding-, Kosten- und Produktstatus-Konflikte werden blockiert;
- parallele Bestätigungen erzeugen keinen doppelten aktuellen Fakt.

### 14.3 Sprache und Plattform

- keine Generierung ohne explizite Sprachwahl;
- `Beide` erzeugt pro Plattform genau eine deutsche und eine englische Variante;
- X, Reddit und LinkedIn erhalten strukturell verschiedene Artefakte;
- Plattformlimits und Community-Regeln bleiben harte Gates.

### 14.4 Pathly und Judge

- Adaptive Entscheidung ist begründet und auditierbar;
- `Nicht erwähnen` entfernt alle direkten und indirekten Pathly-Verweise;
- unbekannte Reddit-Regeln führen standardmäßig zu `omit`;
- Zahlen ohne Binding, ungefüllte `[X]` und qualitative Statuswidersprüche blockieren;
- manuelle Änderungen lösen den Judge erneut aus;
- maximal drei Reparaturen werden ausgeführt;
- Approval wird nach einer Facts-Änderung ungültig.

### 14.5 Regression und Verifikation

- bestehende Writer-, Template-, Discovery-, Publishing- und GDPR-Tests bleiben grün;
- neue Unit-, Route-, DB-Vertrags- und End-to-End-Tests decken die gesamte Kette ab;
- `tsc --noEmit` in Web und MCP bleibt sauber;
- vollständige Vitest-Suite läuft vor Abschluss;
- Migration wird lokal geprüft, aber erst nach einem separaten Live-STOP-Gate angewendet.

## 15. Rollout

1. Additive Repository-Migration für `content_samples`, `proof_assets`, `proof_suggestions`, `content_items`, `workspace_writer_policies` und `post_items`; reine Domainlogik hinter Feature-Flag.
2. Facts-&-Timeline-Bereich im vorhandenen `ProductProfileForm` und Bundle-Import im vorhandenen `ContentDnaPanel`.
3. Writer-Integration über Context Resolver, bestehende Factory, Repair-Loop, Quality Gate, Review und Materialisierung. Deterministische Fakten-Gates blockieren ab Aktivierung; nur der semantische Judge läuft zunächst zusätzlich im Shadow-Modus.
4. Auswertung der semantischen Findings und Aktivierung des semantischen Judges als blockierender Check.
5. Anschluss von Start, Templates, Composer, Splinter/Reuse, Discovery und Changelog über denselben Preflight und Resolver.
6. Live-Migration und Deployment nur nach gesonderter Nutzerfreigabe.

Der Writer bleibt approval-first. „Nie wieder selbst schreiben“ bedeutet: Prolora erzeugt und repariert vollständige Vorschläge; die Verantwortung für Faktenbestätigung und externe Veröffentlichung bleibt beim Menschen.
