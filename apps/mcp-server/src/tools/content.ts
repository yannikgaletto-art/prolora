import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProloraClient } from '../api-client.js';
import { toToolError } from '../errors.js';

// Content-Flywheel (GOAL-RUN6 §12 / GOAL-RUN10): Pillar-Quelle rein →
// Splinter-Vorschläge generieren → akzeptierte Splinter landen als Drafts
// im Kalender. Nichts hier veröffentlicht direkt — accept_splinter erzeugt
// einen Draft im nächsten freien Posting-Slot.

const SPLINTER_PLATFORM_ENUM = z.enum([
  'linkedin',
  'x',
  'bluesky',
  'mastodon',
  'telegram',
  'discord',
  'devto',
  'hashnode',
]);

export function registerContentTools(server: McpServer, client: ProloraClient): void {
  server.tool(
    'add_content_source',
    'Speichert eine Pillar-Quelle für den Content-Flywheel: einen langen Text (Newsletter, Blogartikel, ' +
      'Notizen) oder eine Blog-URL zum Importieren. Mindestens 200 Zeichen. Danach splinter_source aufrufen.',
    {
      kind: z.enum(['paste', 'url']).describe('"paste" = Text direkt mitgeben, "url" = Artikel von einer URL importieren.'),
      title: z.string().max(300).optional().describe('Optionaler Titel der Quelle.'),
      body_md: z.string().max(60_000).optional().describe('Der Pillar-Text (bei kind "paste", Markdown erlaubt).'),
      url: z.string().max(2000).optional().describe('Öffentliche Artikel-URL (bei kind "url").'),
    },
    {},
    async (input) => {
      try {
        const result = await client.createContentSource(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'list_content_sources',
    'Listet die gespeicherten Pillar-Quellen des Workspace (neueste zuerst, max. 50) mit Splinter-Zähler. ' +
      'Nutze wenn: du wissen willst, welche Quellen es gibt oder eine source_id für splinter_source brauchst.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const result = await client.listContentSources();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'splinter_source',
    'Zerlegt eine Pillar-Quelle in mehrere kanal-native Post-Vorschläge (Splinter) für die aktiven ' +
      'Plattformen des Workspace. Kostet AI-Credits. Die Vorschläge werden NICHT gepostet — zeige sie ' +
      'dem Nutzer und übernimm ausgewählte per accept_splinter.',
    {
      source_id: z.string().uuid().describe('id aus list_content_sources oder add_content_source.'),
    },
    {},
    async ({ source_id }) => {
      try {
        const result = await client.splinterSource(source_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'accept_splinter',
    'Übernimmt einen Splinter-Vorschlag als Draft in den Kalender — geplant auf den nächsten freien ' +
      'Slot aus dem Posting-Plan. Veröffentlicht NICHTS sofort. Erfordert einen aktiven Posting-Plan ' +
      '(sonst Konflikt-Fehler). Freigeben später per schedule_post.',
    {
      connection_id: z.string().uuid().describe('Ziel-Account: connection_id aus list_connections.'),
      platform: SPLINTER_PLATFORM_ENUM.describe('Plattform-Name — muss zur connection_id passen.'),
      content: z.string().min(1).max(30_000).describe('Der Splinter-Text (ggf. vom Nutzer angepasst).'),
      first_comment: z.string().max(2_000).optional(),
    },
    {},
    async (input) => {
      try {
        const result = await client.acceptSplinter(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
