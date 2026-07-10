# MCP Setup — erweiterte Doku

## Troubleshooting

**"API-Key ungültig oder abgelaufen"** — `PROLORA_API_KEY` ist falsch, abgelaufen
oder revoked. Prüfe im Dashboard unter Settings → API Keys, ob der Key noch aktiv
ist (kein `revoked_at`). Keys folgen dem Format `sk_live_...`.

**Server startet nicht / Claude zeigt keine Tools** — `PROLORA_API_KEY` fehlt
komplett in der Config. Der Prozess beendet sich sofort mit Exit-Code 1 und einer
Fehlermeldung auf stderr; Claude Desktop zeigt den MCP-Server dann als "failed" an.

**Verbindungsprobleme** — prüfe `PROLORA_BASE_URL`, falls gesetzt (z.B. für
Self-Hosting). Ohne die Variable wird `https://api.prolora.eu/v1` verwendet.

**Timeout-Fehler** — Standard-Timeout ist 30s, für KI-lastige Tools
(`ask_feedback`, `adapt_content`, `draft_reply`, `discover_communities`,
`get_feedback_summary`, `reuse_content`) 60s. Bei wiederholten Timeouts: Prolora
könnte überlastet sein — später erneut versuchen.

## Umgebungsvariablen

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `PROLORA_API_KEY` | Ja | — | Auth-Token, gesendet als `x-prolora-key` Header. |
| `PROLORA_BASE_URL` | Nein | `https://api.prolora.eu/v1` | API-Basis-URL für Self-Hosting/Tests. |

## Tool-Referenz

### Publishing

| Tool | Input | Output (Kurzform) |
|---|---|---|
| `create_post` | `content`, `platforms` (connection_ids), `scheduled_at?`, `adapt_content?`, `first_comment?` | `post_group_id`, `items[]`, `credits_used` |
| `adapt_content` | `content`, `platforms` (Namen: linkedin/x/bluesky/mastodon/telegram) | `adaptations[]` (pro Plattform: content, adapted, warning?) |
| `get_post_status` | `post_group_id` | Post-Group inkl. `post_items[]` mit Status/Metriken |
| `list_posts` | `status?`, `limit?`, `offset?` | `posts[]`, `page`, `per_page`, `total` |
| `delete_post` | `post_group_id` | `items[]` (item_id, deleted, note?) — **destruktiv** |
| `retry_post` | `post_group_id` | `retried` (Anzahl neu gequeuter Items) |
| `list_connections` | — | `connections[]` (connection_id, platform, status, ...) |
| `validate_content` | `content`, `platforms` | `overall_valid`, pro Plattform valid + reasons — **rein lokal, kein API-Call** |

### Listening

| Tool | Input | Output (Kurzform) |
|---|---|---|
| `get_feedback` | `sentiment?`, `source?`, `since?`, `limit?` | `feedback[]`, `page`, `per_page`, `total` |
| `get_feedback_summary` | `period?` (7d/30d/90d) | Sentiment/Kategorie/Plattform-Verteilung, `top_topics`, `sentiment_trend`, `ai_executive_summary` |
| `get_alerts` | `limit?` | `alerts[]` — Feedback mit urgency high/critical, neueste zuerst |
| `ask_feedback` | `question` | `answer`, `confidence`, `based_on_count`, `key_quotes[]` |
| `get_sentiment_trend` | `days?` | `sentiment_trend[]` (date, avg_score, count) |
| `get_top_topics` | `period?` (week/month), `limit?` | `top_topics[]` (topic, count, avg_sentiment) |
| `mark_feedback` | `feedback_id`, `action` (reviewed/actioned/archived) | Aktualisiertes Feedback-Item; `actioned` schließt verknüpfte Board-Items |
| `get_competitors` | `limit?` | Feedback mit `source_platform="competitor"` (nur wenn so getaggt importiert) |
| `export_feedback` | `format` (json/csv), `since?`, `sentiment?` | Bis zu 200 Einträge als JSON- oder CSV-Text |

### Discovery

| Tool | Input | Output (Kurzform) |
|---|---|---|
| `discover_communities` | `website_url?` ODER `product_description?` + `target_audience?` | `communities[]`, `total` |
| `draft_reply` | `opportunity_id`, `tone?` | `draft_id`, `content`, `reasoning`, `community_rules_check` — **postet nie automatisch** |
| `get_opportunities` | `min_relevance?`, `status?`, `limit?` | `opportunities[]`, `page`, `per_page`, `total` |
| `confirm_posted` | `opportunity_id`, `posted_url?` | Bestätigung + Cooldown-Update — reine Status-Änderung, kein echter Post |
| `reuse_content` | `original_content`, `target_community`, `angle_shift`, `original_post_id?` | Adaptierter Content für die Ziel-Community |
| `get_response_map` | `category?`, `limit?` | `entries[]` — bewährte Antworten nach Engagement sortiert |
| `add_response_map_entry` | `question_pattern`, `best_answer`, `intent_type?`, `proof_asset_url?` | Gespeicherter Eintrag |
| `get_voice_config` | — | Aktuelle Brand-Voice |
| `update_voice_config` | `tone?`, `avoid_patterns?`, `example_replies?`, `language?` | Aktualisierte Brand-Voice |

## Abweichungen von der Spec

`GOAL-RUN3-MCP-SERVER.md` beschreibt 27 Tools anhand angenommener Endpoint-Formen.
Beim Lesen der tatsächlichen Routes in `apps/web/app/api/v1/` zeigten sich mehrere
Abweichungen zwischen Spec-Annahme und echter API. Guardrail der Spec selbst:
"Wenn ein Endpoint fehlt → STOP und melden" — genau das passiert hier, Tool für
Tool:

1. **`get_usage` — nicht gebaut.** Es existiert kein `GET /usage` Endpoint (nur ein
   dashboard-interner Server Action `apps/web/lib/settings/usage.ts`, der direkt
   auf die DB zugreift und für einen reinen API-Client nicht erreichbar ist). Eine
   neue Route zu bauen ist per Guardrail verboten, direkter DB-Zugriff ebenso —
   also bleibt das Tool weg statt es zu simulieren. **Tool-Count: 26 statt 27.**

2. **Auth-Header.** Spec nimmt `Authorization`-Header an; die echte
   `auth-middleware.ts` erwartet `x-prolora-key`. Der Client nutzt den echten
   Header.

3. **`get_feedback_summary` Periode.** Spec nimmt `day`/`week`/`month` an; die
   echte Route akzeptiert nur `7d`/`30d`/`90d`. `get_sentiment_trend` (`days`) und
   `get_top_topics` (`period: week/month`) mappen intern auf diese echten Werte.

4. **`get_alerts`.** Kein `alert=`/`unread=` Query-Parameter existiert. Implementiert
   als zwei Abfragen (`urgency=critical`, `urgency=high`), client-seitig gemerged
   und sortiert — keine Gelesen/Ungelesen-Unterscheidung möglich.

5. **`get_competitors`.** Kein dedizierter Wettbewerbs-Endpoint. Filtert
   `GET /feedback` nach `platform=competitor` — liefert nur Ergebnisse, wenn
   Feedback manuell mit dieser `source_platform` importiert wurde.

6. **`export_feedback`.** Keine `export=`/`format=` Query-Parameter an der Route.
   Holt bis zu 2 Seiten (200 Einträge) über die normale Pagination und formatiert
   client-seitig als JSON oder CSV.

7. **`validate_content`.** Kein `/content/validate` Endpoint. Die Ground-Truth-Regeln
   liegen in `apps/web/lib/validation/platform-rules.ts` — laut Sperrzone nur als
   Referenz lesbar, nicht importierbar (das Package hat nur `@modelcontextprotocol/sdk`
   + `zod` als Dependency). Zeichenlimits sind daher als statische Konstante lokal
   gespiegelt, rein clientseitig geprüft, kein API-Call.

8. **`get_opportunities` `min_relevance`.** Kein Server-Filter dafür — wird
   client-seitig auf das sortierte Ergebnis angewendet.

9. **`get_response_map` `category`/`limit`.** Route liefert immer alle Einträge
   ohne Filter — beides wird client-seitig angewendet.

10. **`add_response_map_entry` Feldnamen.** Spec schlägt `content`/`context` vor;
    die echte Route erwartet `question_pattern`/`best_answer`. Tool-Input folgt der
    echten Route.

11. **`reuse_content` Input.** Spec schlägt `source_post_id` vor; die echte Route
    lädt keinen Content anhand einer ID nach, sondern erwartet den Text direkt
    (`original_content`, min. 20 Zeichen). `original_post_id` bleibt als optionales
    Zusatzfeld erhalten.

12. **`draft_reply` `angle`.** Spec erwähnt ein `angle`-Feld; die echte
    `draftRequestSchema`/`generateDraft`-Pipeline kennt nur `tone` (via
    `voice_config`). `angle` wurde weggelassen statt ein wirkungsloses Feld
    anzubieten (Ehrlichkeits-Prinzip: kein Input, der nichts bewirkt).

13. **`mark_feedback` Status-Werte.** Spec nennt `reviewed`/`archived`/`starred`;
    die echte Route erlaubt nur `reviewed`/`actioned`/`archived` mit einer
    State-Machine (`new→reviewed→actioned→archived`) — `starred` existiert nicht.
    Tool-Enum folgt der echten Route.
