import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProloraClient } from '../api-client.js';
import { toToolError } from '../errors.js';

const PLATFORM_ENUM = z.enum(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']);
const SCORE_PLATFORM_ENUM = z.enum([
  'linkedin',
  'x',
  'bluesky',
  'mastodon',
  'telegram',
  'discord',
  'devto',
  'hashnode',
]);

export function registerPublishingTools(server: McpServer, client: ProloraClient): void {
  server.tool(
    'create_post',
    'Erstellt einen Post auf einer oder mehreren Social-Media-Plattformen. Sofort oder geplant. ' +
      'platforms erwartet die connection_id(s) aus list_connections, nicht Plattform-Namen.',
    {
      content: z.string().min(1).max(10000).describe('Der Post-Text.'),
      platforms: z
        .array(z.string().uuid())
        .min(1)
        .describe('Eine oder mehrere connection_id(s) aus list_connections — nicht Plattform-Namen wie "linkedin".'),
      scheduled_at: z.string().datetime().optional().describe('ISO-Zeitstempel für geplantes Posten. Weglassen = sofort.'),
      scheduled_tz: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe('IANA-Zeitzone für die Kalender-Anzeige, z. B. "Europe/Berlin".'),
      draft: z
        .boolean()
        .optional()
        .describe('true = nur als Entwurf speichern, es wird NICHTS veröffentlicht. Später per schedule_post planen oder freigeben.'),
      adapt_content: z.boolean().optional().describe('Text automatisch pro Plattform anpassen (Ton, Länge, Hashtags).'),
      first_comment: z.string().max(2000).optional().describe('Optionaler erster Kommentar, direkt nach dem Post gesetzt.'),
    },
    {},
    async (input) => {
      try {
        const result = await client.createPost(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'adapt_content',
    'Passt einen Text für verschiedene Plattformen an (Ton, Länge, Hashtags). Preview ohne zu posten.',
    {
      content: z.string().min(1).max(10000),
      platforms: PLATFORM_ENUM.array().min(1).max(5).describe('Plattform-Namen wie "linkedin", "x", "bluesky".'),
    },
    {},
    async (input) => {
      try {
        const result = await client.adaptContent(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'score_post',
    'Bewertet einen Post-Entwurf vor dem Veröffentlichen. mode "checks" ist kostenlos und prüft ' +
      'Format, Links und Plattform-Limits; mode "full" (Default) ergänzt Hook-/Struktur-Coaching für 1 AI-Credit.',
    {
      content: z.string().min(1).max(30_000).describe('Der noch nicht veröffentlichte Post-Text.'),
      platform: SCORE_PLATFORM_ENUM.describe('Plattform-Name, keine connection_id.'),
      first_comment: z.string().max(2_000).optional(),
      language: z.string().length(2).optional().describe('Optionale Ausgabesprache, z. B. de, en oder es.'),
      connection_id: z.string().uuid().optional().describe('Optional für eine kalibrierte Interaktionsspanne aus diesem Account.'),
      mode: z.enum(['checks', 'full']).default('full').optional(),
    },
    {},
    async (input) => {
      try {
        const result = await client.scorePost(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_post_status',
    'Zeigt den Status und Performance-Metriken eines Posts.',
    {
      post_group_id: z.string().uuid(),
    },
    { readOnlyHint: true },
    async ({ post_group_id }) => {
      try {
        const result = await client.getPost(post_group_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'list_posts',
    'Listet deine Posts auf. Filter nach Status, Plattform und Zeitraum möglich. ' +
      'Nutze wenn: du eine flache Liste willst. Für die Wochen-/Monatsansicht mit Drafts nutze get_calendar.',
    {
      status: z.enum(['published', 'failed', 'scheduled', 'queued', 'publishing', 'deleted']).optional(),
      platform: PLATFORM_ENUM.optional().describe('Plattform-Name — filtert auf Posts mit einem Item dieser Plattform.'),
      date_from: z.string().datetime().optional().describe('Nur Posts, die ab diesem Zeitpunkt erstellt wurden.'),
      date_to: z.string().datetime().optional().describe('Nur Posts, die bis zu diesem Zeitpunkt erstellt wurden.'),
      limit: z.number().int().min(1).max(100).default(20).optional(),
      offset: z.number().int().min(0).optional(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const result = await client.listPosts(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'schedule_post',
    'Plant einen bestehenden Post um oder veröffentlicht ihn sofort. Entwürfe (draft) werden dabei ' +
      'zu geplanten Posts. Nutze wenn: der Post schon existiert (post_group_id). Für neue Posts nutze ' +
      'create_post, für fehlgeschlagene retry_post. scheduled_at und publish_now schließen sich aus.',
    {
      post_group_id: z.string().uuid().describe('Die post_group_id aus create_post, list_posts oder get_calendar.'),
      scheduled_at: z
        .string()
        .datetime()
        .optional()
        .describe('Neuer Veröffentlichungszeitpunkt (ISO, UTC). Nicht zusammen mit publish_now.'),
      scheduled_tz: z.string().min(1).max(64).optional().describe('IANA-Zeitzone, z. B. "Europe/Berlin".'),
      publish_now: z
        .boolean()
        .optional()
        .describe('true = sofort veröffentlichen (Entwurf/geplanter Post geht in die Queue). Nicht zusammen mit scheduled_at.'),
    },
    {},
    async (input) => {
      if (Boolean(input.scheduled_at) === Boolean(input.publish_now)) {
        return toToolError(
          new Error('Gib entweder scheduled_at ODER publish_now: true an — genau eins von beiden.')
        );
      }
      try {
        const result = await client.schedulePost(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_calendar',
    'Zeigt den Posting-Kalender: alle geplanten/veröffentlichten Posts im Zeitfenster plus ungeplante ' +
      'Entwürfe. Nutze wenn: "Was geht diese Woche raus?" Maximal 62 Tage pro Abfrage.',
    {
      from: z.string().datetime().describe('Fensterbeginn (ISO, UTC), z. B. Montag 00:00.'),
      to: z.string().datetime().describe('Fensterende (ISO, UTC). Muss nach from liegen, max. 62 Tage später.'),
    },
    { readOnlyHint: true },
    async ({ from, to }) => {
      try {
        const result = await client.getCalendar(from, to);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'bulk_create_posts',
    'Erstellt bis zu 100 Posts in einem Aufruf (z. B. einen Wochenplan). Jeder Eintrag hat dieselben ' +
      'Felder wie create_post. Achtung: verbraucht pro Post Kontingent; Teilfehler werden pro Eintrag gemeldet.',
    {
      posts: z
        .array(
          z.object({
            content: z.string().min(1).max(10000),
            platforms: z.array(z.string().uuid()).min(1).describe('connection_id(s) aus list_connections.'),
            scheduled_at: z.string().datetime().optional(),
            scheduled_tz: z.string().min(1).max(64).optional(),
            draft: z.boolean().optional(),
            adapt_content: z.boolean().optional(),
            first_comment: z.string().max(2000).optional(),
          })
        )
        .min(1)
        .max(100),
    },
    {},
    async ({ posts }) => {
      try {
        const result = await client.bulkCreatePosts(posts);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_optimal_times',
    'Zeigt die 3 besten Posting-Zeitfenster eines Accounts (aus Engagement der letzten Posts). ' +
      'Braucht mindestens 30 veröffentlichte Posts auf der Connection. Ergebnis mit schedule_post kombinieren.',
    {
      connection_id: z.string().uuid().describe('connection_id aus list_connections.'),
    },
    { readOnlyHint: true },
    async ({ connection_id }) => {
      try {
        const result = await client.getOptimalTimes(connection_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_posting_slot',
    'Liefert den nächsten freien Slot aus dem Posting-Plan des Workspace für die angegebenen Accounts. ' +
      'Nutze wenn: du planen willst, ohne Zeiten zu raten — erst Slot holen, dann create_post/schedule_post ' +
      'mit dem gelieferten instant. Liefert slot: null, wenn kein Posting-Plan existiert.',
    {
      connection_ids: z.array(z.string().uuid()).min(1).max(20).describe('connection_id(s) aus list_connections.'),
    },
    { readOnlyHint: true },
    async ({ connection_ids }) => {
      try {
        const result = await client.nextPostingSlot(connection_ids);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'delete_post',
    'Löscht einen geplanten Post. Bereits veröffentlichte Posts können nicht gelöscht werden — ' +
      'die Plattform-Löschung wird versucht (best effort), der Post verschwindet in jedem Fall aus Prolora.',
    {
      post_group_id: z.string().uuid(),
    },
    { destructiveHint: true },
    async ({ post_group_id }) => {
      try {
        const result = await client.deletePost(post_group_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'retry_post',
    'Versucht einen fehlgeschlagenen Post erneut zu veröffentlichen. Wirkt nur auf Items mit Status "failed".',
    {
      post_group_id: z.string().uuid(),
    },
    {},
    async ({ post_group_id }) => {
      try {
        const result = await client.retryPost(post_group_id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'list_connections',
    'Zeigt alle verbundenen Social-Media-Accounts mit Status. Die zurückgegebene connection_id ' +
      'wird als platforms-Wert bei create_post benötigt.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const result = await client.listConnections();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'list_templates',
    'Listet die Post-Vorlagen (Rezepte mit Hooks, Skript-Struktur und CTA-Mechanik). Filterbar nach ' +
      'Ziel (intent), Post-Typ oder Plattform. Die zurückgegebenen slots sind die Fragen, deren ' +
      'Antworten draft_from_template erwartet.',
    {
      intent: z
        .enum(['value', 'product', 'community', 'social_proof', 'personal_brand'])
        .optional()
        .describe('Was soll der Post erreichen? (z. B. "value" = Autorität aufbauen)'),
      post_type: z
        .enum([
          'value_edu',
          'product_demo',
          'review',
          'unboxing',
          'tutorial',
          'transformation',
          'build_in_public',
          'lifestyle',
          'community_fomo',
          'crowdsourcing',
        ])
        .optional(),
      platform: SCORE_PLATFORM_ENUM.optional().describe('Nur Vorlagen, die diese Plattform empfehlen.'),
      format: z
        .enum(['text', 'thread', 'carousel_pdf', 'image_text', 'poll'])
        .optional()
        .describe('Nur Vorlagen dieses Formats.'),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const result = await client.listTemplates(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'draft_from_template',
    'Erzeugt einen Post-Entwurf aus einer Vorlage. mode "ai" (Default) kostet 1 AI-Credit; ' +
      'mode "scaffold" ist kostenlos und liefert ein Gerüst zum Selbst-Ausfüllen. Der Entwurf wird ' +
      'NICHT gepostet — zeige ihn dem Nutzer und nutze danach create_post.',
    {
      template_id: z.string().min(1).describe('id aus list_templates.'),
      slots: z
        .record(z.string(), z.string().max(500))
        .describe('Antworten auf die Slot-Fragen der Vorlage (slot-key → Antwort).'),
      target_platforms: PLATFORM_ENUM.array()
        .min(1)
        .max(5)
        .describe('Plattform-NAMEN (nicht connection_ids) — bestimmen Ton, CTA-Regeln und Längenbudget.'),
      mode: z
        .enum(['scaffold', 'ai'])
        .optional()
        .describe('"ai" (Default, 1 Credit, LLM-Draft) oder "scaffold" (0 Credits, Gerüst).'),
    },
    {},
    async (input) => {
      try {
        const result = await client.draftFromTemplate(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'validate_content',
    'Prüft ob ein Text für die gewählten Plattformen gültig ist (Zeichenlimit). Rein lokale Prüfung, ' +
      'kein API-Call — für Media-Regeln und Sonderfälle nutze adapt_content oder poste testweise.',
    {
      content: z.string().min(1),
      platforms: SCORE_PLATFORM_ENUM.array().min(1),
    },
    { readOnlyHint: true },
    async ({ content, platforms }) => {
      const report = platforms.map((platform) => {
        const limit = TEXT_LIMITS[platform];
        const length = content.length;
        const valid = length <= limit;
        return {
          platform,
          valid,
          reasons: valid ? [] : [`Text hat ${length} Zeichen, Limit für ${platform} ist ${limit}.`],
        };
      });
      return { content: [{ type: 'text', text: JSON.stringify({ overall_valid: report.every((r) => r.valid), platforms: report }, null, 2) }] };
    }
  );
}

// Kein /content/validate Endpoint in der REST API — Zeichenlimits sind hier
// lokal gespiegelt (Ground Truth bleibt apps/web/lib/validation/platform-rules.ts,
// dieses Package darf davon aber nicht importieren, siehe Guardrails).
const TEXT_LIMITS: Record<string, number> = {
  linkedin: 3000,
  x: 280,
  bluesky: 300, // 300 Grapheme — hier als Zeichen genähert
  mastodon: 500, // Default — echte Instanz-Limits können abweichen
  telegram: 4096,
  discord: 2000,
  devto: 10000,
  hashnode: 10000,
};
