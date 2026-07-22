# @prolora/mcp-server

Prolora direkt in Claude Desktop und Claude Code — posten, planen, Kalender
lesen, Content splittern, Feedback abfragen und Communities entdecken, ohne
das Dashboard zu öffnen.

## Setup (3 Schritte)

### 1. API-Key holen

Dashboard → Settings → API Keys → "Neuen Key erstellen". Kopiere den Key
(`sk_live_...`) — er wird nur einmal angezeigt.

### 2. Config einfügen

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prolora": {
      "command": "npx",
      "args": ["@prolora/mcp-server"],
      "env": {
        "PROLORA_API_KEY": "sk_live_dein_key_hier",
        "PROLORA_BASE_URL": "https://<deine-prolora-instanz>/api/v1"
      }
    }
  }
}
```

**Claude Code** (`.claude/claude_desktop_config.json` im Projekt oder global):

```json
{
  "mcpServers": {
    "prolora": {
      "command": "npx",
      "args": ["@prolora/mcp-server"],
      "env": {
        "PROLORA_API_KEY": "sk_live_dein_key_hier",
        "PROLORA_BASE_URL": "https://<deine-prolora-instanz>/api/v1"
      }
    }
  }
}
```

> **Wichtig:** Setze `PROLORA_BASE_URL` auf deine Prolora-Instanz (Vercel-URL
> oder eigene Domain, Pfad `/api/v1`). Ohne diesen Wert greift der Default
> `https://api.prolora.eu/v1` — der Server warnt beim Start auf stderr, wenn
> die API dort nicht erreichbar ist. Für lokale Tests:
> `http://localhost:3000/api/v1`.

### 3. Claude neustarten

Nach dem Neustart zeigt Claude die 38 Prolora-Tools als verfügbar an.

---

## Tools (38)

**Publishing & Kalender (16)** — `create_post` · `schedule_post` · `get_calendar` ·
`bulk_create_posts` · `get_posting_slot` · `get_optimal_times` · `adapt_content` ·
`score_post` · `get_post_status` · `list_posts` · `delete_post` · `retry_post` ·
`list_connections` · `list_templates` · `draft_from_template` · `validate_content`

**Content-Flywheel (4)** — `add_content_source` · `list_content_sources` ·
`splinter_source` · `accept_splinter`

**Listening (9)** — `get_feedback` · `get_feedback_summary` · `get_alerts` ·
`ask_feedback` · `get_sentiment_trend` · `get_top_topics` · `mark_feedback` ·
`get_competitors` · `export_feedback`

**Discovery (9)** — `discover_communities` · `draft_reply` · `get_opportunities` ·
`confirm_posted` · `reuse_content` · `get_response_map` · `add_response_map_entry` ·
`get_voice_config` · `update_voice_config`

## Beispiel-Prompts

1. "Poste 'Neues Feature gelauncht! 🚀' auf LinkedIn und Bluesky"
2. "Was geht diese Woche raus?" (→ `get_calendar`)
3. "Verschieb den Post von morgen auf Freitag 9 Uhr" (→ `schedule_post`)
4. "Nimm meinen Newsletter und mach daraus Posts für alle Kanäle" (→ Splinter-Flywheel)
5. "Was sagen Kunden diese Woche über unser Onboarding?"

## Umgebungsvariablen

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `PROLORA_API_KEY` | Ja | — | Auth gegen die Prolora API (`x-prolora-key` Header). Server startet mit Exit-Code 1 ohne diesen Wert. |
| `PROLORA_BASE_URL` | Empfohlen | `https://api.prolora.eu/v1` | URL deiner Prolora-Instanz inkl. `/api/v1`. Der Server pingt die API beim Start und warnt auf stderr, wenn sie nicht erreichbar ist. |

## Troubleshooting

- **"Prolora-API unter … nicht erreichbar"** — `PROLORA_BASE_URL` prüfen. Die
  URL muss auf die laufende Next.js-App zeigen und mit `/api/v1` enden.
- **"API-Key ungültig"** — Key im Dashboard neu erzeugen; er beginnt mit `sk_live_`.
- **Timeouts bei KI-Tools** (`splinter_source`, `adapt_content`, …) — LLM-Calls
  haben 60 s Timeout; bei Überschreitung erneut versuchen.

## Abweichungen von der Spec (GOAL-RUN3)

Details und Begründungen: [`docs/mcp-setup.md`](./docs/mcp-setup.md#abweichungen-von-der-spec).

Kurzfassung:
- **`get_usage` nicht gebaut** — kein `GET /usage` Endpoint in der REST API. Laut
  Guardrail "keine neuen Routes" wird das Tool nicht simuliert, sondern weggelassen.
- **`get_alerts`, `get_competitors`, `export_feedback`** nutzen existierende Filter
  von `GET /feedback` (urgency/platform/Pagination) statt der in der Spec
  angenommenen `alert=`/`source=competitor`/`export=`-Query-Parameter, die es in
  der echten Route nicht gibt.
- **`validate_content`** macht keinen API-Call — es gibt keinen
  `/content/validate` Endpoint. Zeichenlimits sind lokal gespiegelt.
- **`get_response_map`** filtert `category`/`limit` clientseitig — die Route
  liefert immer alle Einträge.
- **`add_response_map_entry`** nutzt die echten Feldnamen der Route
  (`question_pattern`, `best_answer`) statt der in der Spec vorgeschlagenen
  (`content`, `context`).
- **`reuse_content`** verlangt den Original-Text direkt (`original_content`), nicht
  nur eine ID — die Route lädt keinen Content nach.
