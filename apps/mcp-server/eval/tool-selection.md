# Tool-Selection Eval

12 Beispiel-Prompts gegen die MUST- und SHOULD-Tools (Phase E aus GOAL-RUN3-MCP-SERVER.md).
Prompt 12 im Original-Spec-Vorschlag war `get_usage` — dieses Tool existiert nicht
(kein `GET /usage` Endpoint in der REST API, siehe README "Abweichungen"). Ersetzt
durch einen `list_connections`-Prompt, damit weiterhin 12 Prompts gegen tatsächlich
existierende Tools laufen.

| # | Prompt | Erwartetes Tool |
|---|---|---|
| 1 | „Poste 'Wir haben Feature X gelauncht' auf LinkedIn und X" | `create_post` |
| 2 | „Was sagen Kunden diese Woche über unser Onboarding?" | `ask_feedback` |
| 3 | „Zeig mir die letzten 10 negativen Feedback-Einträge" | `get_feedback` |
| 4 | „Gib mir eine Zusammenfassung des Feedbacks vom letzten Monat" | `get_feedback_summary` |
| 5 | „Wie hat sich die Stimmung in den letzten 30 Tagen entwickelt?" | `get_sentiment_trend` |
| 6 | „Worüber reden unsere Kunden am häufigsten?" | `get_top_topics` |
| 7 | „Gibt es dringendes Feedback, um das ich mich kümmern sollte?" | `get_alerts` |
| 8 | „Finde Reddit-Communities für mein SaaS-Tool" | `discover_communities` |
| 9 | „Zeig mir aktuelle Threads wo ich helfen könnte" | `get_opportunities` |
| 10 | „Schreib mir einen Antwort-Entwurf für Opportunity #3" | `draft_reply` |
| 11 | „Lösch den geplanten Post von morgen" | `delete_post` (+ Rückfrage durch `destructiveHint`) |
| 12 | „Welche Accounts sind gerade mit Prolora verbunden?" | `list_connections` |

## Ausführung

**Nicht live gegen Claude Desktop/Code durchgespielt** — dafür fehlt in dieser
Umgebung eine laufende Prolora-API-Instanz mit gültigem `PROLORA_API_KEY` und ein
interaktiver Claude-Desktop-Client. Stattdessen: statische Analyse — jeder Prompt
wurde gegen die tatsächlichen `description`- und „Nutze wenn:"-Texte der 26 Tools
geprüft (dieselbe Information, die ein MCP-Client zur Tool-Auswahl sieht).

| # | Ergebnis | Begründung |
|---|---|---|
| 1 | ✅ `create_post` | Einzige Wortkombination "posten"+Plattformen → Tool-Beschreibung exakter Treffer. |
| 2 | ✅ `ask_feedback` | Offene Frage, keine Liste/Zusammenfassung angefragt — Beschreibung nennt genau dieses Muster als Beispiel. |
| 3 | ✅ `get_feedback` | "Zeig mir ... Einträge" (Liste) + Sentiment-Filter — "Nutze wenn"-Zeile grenzt genau dagegen `ask_feedback`/`get_feedback_summary` ab. |
| 4 | ✅ `get_feedback_summary` | "Zusammenfassung" + Zeitraum — Wort "Zusammenfassung" taucht nur in dieser Tool-Beschreibung auf. |
| 5 | ✅ `get_sentiment_trend` | "Stimmung ... entwickelt" + expliziter Zeitraum → Verlaufs-Signalwort laut "Nutze wenn"-Zeile. |
| 6 | ✅ `get_top_topics` | "Worüber reden" = Themen-Frage, kein Zeitverlauf, keine Einzel-Zitate. |
| 7 | ✅ `get_alerts` | "dringendes Feedback" trifft direkt auf die Beschreibung ("hoher oder kritischer Dringlichkeit"). |
| 8 | ✅ `discover_communities` | "Communities finden" ist die wörtliche erste Satz-Paraphrase der Tool-Beschreibung. |
| 9 | ✅ `get_opportunities` | "Threads wo ich helfen könnte" — exakte Formulierung aus der Tool-Beschreibung. |
| 10 | ✅ `draft_reply` | "Antwort-Entwurf" + Opportunity-Referenz — eindeutig, einziges Draft-Tool im Discovery-Bereich. |
| 11 | ✅ `delete_post` | "Lösch ... Post" ist eindeutig destruktiv; `destructiveHint: true` ist gesetzt (Oracle 4), MCP-Client fragt vor Ausführung nach. |
| 12 | ✅ `list_connections` | "Accounts ... verbunden" ist die wörtliche Paraphrase der Tool-Beschreibung; kein anderes Tool nennt "Accounts". |

**Ergebnis: 12/12 in der statischen Analyse.** Das ist optimistischer als ein echter
Live-Test — dieselbe Instanz, die die Tools beschrieben hat, bewertet hier auch die
Auswahl. Ein echter Test mit einem frischen Claude-Desktop-Kontext gegen eine
laufende Instanz ist der nächste Schritt (siehe README "Nächster Schritt") und kann
abweichen, insbesondere bei Prompt 3–7 (die fünf sich überlappenden Feedback-Tools),
wo laut Spec Verwechslung am wahrscheinlichsten ist.

---

## Erweiterung GOAL-RUN10 (v1.1.0): 6 neue Prompts

Neue Verwechslungszone laut Doc: `schedule_post` vs. `create_post` vs. `retry_post`,
plus der Splinter-Flywheel. Statische Analyse gegen die Tool-Descriptions (wie oben):

| # | Prompt | Erwartetes Tool | Ergebnis |
|---|---|---|---|
| 13 | „Verschieb den Post von morgen auf Freitag 9 Uhr" | `schedule_post` | ✅ — „Plant einen bestehenden Post um"; `create_post` scheidet aus, weil kein neuer Inhalt genannt wird. Vorher `list_posts`/`get_calendar` zum Auffinden der post_group_id ist erlaubtes Chaining. |
| 14 | „Veröffentliche den Entwurf jetzt sofort" | `schedule_post` (publish_now) | ✅ — „Entwürfe (draft) werden dabei…" + publish_now-Beschreibung; `retry_post` grenzt sich auf Status "failed" ab. |
| 15 | „Was geht diese Woche raus?" | `get_calendar` | ✅ — wörtlich in der Description als „Nutze wenn"-Beispiel hinterlegt; `list_posts` verweist explizit auf get_calendar für Kalenderfragen. |
| 16 | „Nimm meinen Newsletter und mach daraus Posts für alle Kanäle" | `add_content_source` → `splinter_source` | ✅ — Flywheel-Kette ist in beiden Descriptions beschrieben („Danach splinter_source aufrufen"). |
| 17 | „Plane diese 5 Posts über die Woche verteilt ein" | `bulk_create_posts` | ✅ — „bis zu 100 Posts in einem Aufruf (z. B. einen Wochenplan)"; einzelne create_post-Calls wären nicht falsch, aber die Description macht bulk zum ersten Treffer. |
| 18 | „Wann poste ich am besten auf LinkedIn?" | `get_optimal_times` | ✅ — „beste Posting-Zeitfenster"; Abgrenzung zu `get_posting_slot` (Plan-Slot statt Engagement-Analyse) steht in beiden Descriptions. |

**Ergebnis: 18/18 statisch (Ziel ≥ 16/18).** Gleiche Einschränkung wie oben: statische
Analyse durch dieselbe Instanz, Live-Test mit frischem Kontext steht aus.
