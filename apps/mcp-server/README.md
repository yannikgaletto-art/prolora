# @prolora/mcp-server

Prolora direkt in Claude Desktop und Claude Code — posten, Feedback abfragen und
Communities entdecken, ohne das Dashboard zu öffnen.

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
        "PROLORA_API_KEY": "sk_live_dein_key_hier"
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
        "PROLORA_API_KEY": "sk_live_dein_key_hier"
      }
    }
  }
}
```

### 3. Claude neustarten

Nach dem Neustart zeigt Claude die 26 Prolora-Tools als verfügbar an.

---

## Tools (26)

> Definition of Done fordert 27 Tools — `get_usage` fehlt bewusst, siehe
> "Abweichungen" unten. Alle anderen 26 aus der Spec sind vollständig implementiert.

**Publishing (8)** — `create_post` · `adapt_content` · `get_post_status` ·
`list_posts` · `delete_post` · `retry_post` · `list_connections` · `validate_content`

**Listening (9)** — `get_feedback` · `get_feedback_summary` · `get_alerts` ·
`ask_feedback` · `get_sentiment_trend` · `get_top_topics` · `mark_feedback` ·
`get_competitors` · `export_feedback`

**Discovery (9)** — `discover_communities` · `draft_reply` · `get_opportunities` ·
`confirm_posted` · `reuse_content` · `get_response_map` · `add_response_map_entry` ·
`get_voice_config` · `update_voice_config`

## Beispiel-Prompts

1. "Poste 'Neues Feature gelauncht! 🚀' auf LinkedIn und Bluesky"
2. "Was sagen Kunden diese Woche über unser Onboarding?"
3. "Zeig mir Threads wo ich helfen kann"
4. "Schreib einen Reply-Draft für Opportunity #3"
5. "Welche Accounts sind gerade verbunden?"

## Umgebungsvariablen

| Variable | Pflicht | Default | Zweck |
|---|---|---|---|
| `PROLORA_API_KEY` | Ja | — | Auth gegen die Prolora API (`x-prolora-key` Header). Server startet mit Exit-Code 1 ohne diesen Wert. |
| `PROLORA_BASE_URL` | Nein | `https://api.prolora.eu/v1` | Für Self-Hosting / lokale Test-Instanzen. |

## Abweichungen von der Spec

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
