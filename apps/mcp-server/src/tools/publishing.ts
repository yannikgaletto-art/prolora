import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProloraClient } from '../api-client.js';
import { toToolError } from '../errors.js';

const PLATFORM_ENUM = z.enum(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']);

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
    'Listet deine Posts auf. Filter nach Status möglich.',
    {
      status: z.enum(['published', 'failed', 'scheduled', 'queued']).optional(),
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
      platform: PLATFORM_ENUM.optional().describe('Nur Vorlagen, die diese Plattform empfehlen.'),
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
      platforms: PLATFORM_ENUM.array().min(1),
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
  bluesky: 300,
  mastodon: 500,
  telegram: 4096,
};
