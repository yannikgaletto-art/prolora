import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProloraClient } from '../api-client.js';
import { toToolError } from '../errors.js';

const VOICE_TONE = z.enum(['casual', 'professional', 'technical', 'empathetic']);

export function registerDiscoveryTools(server: McpServer, client: ProloraClient): void {
  server.tool(
    'discover_communities',
    'Findet relevante Online-Communities für dein Produkt. Gib deine Website-URL ein ' +
      '(für automatische Kontext-Erkennung) oder beschreibe Produkt und Zielgruppe direkt.',
    {
      website_url: z.string().url().optional().describe('Deine Produkt-Website — leitet Beschreibung und Zielgruppe automatisch ab.'),
      product_description: z.string().min(10).max(2000).optional(),
      target_audience: z.string().min(10).max(1000).optional(),
    },
    async (input) => {
      try {
        const result = await client.discoverCommunities(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'draft_reply',
    'Generiert einen Reply-Draft für eine entdeckte Opportunity (aus get_opportunities). ' +
      'Der Draft respektiert Community-Regeln und deine Brand-Voice. Du kopierst und postest ihn selbst — ' +
      'Prolora postet niemals automatisch in Communities.',
    {
      opportunity_id: z.string().uuid().describe('ID der Opportunity, z.B. aus get_opportunities.'),
      tone: VOICE_TONE.optional().describe('Überschreibt den Standard-Ton nur für diesen Draft.'),
    },
    async (input) => {
      try {
        const result = await client.draftReply(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_opportunities',
    'Zeigt aktuelle Threads in deinen Communities, in denen du hilfreich antworten könntest.',
    {
      min_relevance: z.number().min(0).max(1).default(0.6).optional(),
      status: z.enum(['new', 'drafted', 'posted', 'skipped']).optional(),
      limit: z.number().int().min(1).max(100).default(10).optional(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const result = await client.getOpportunities(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'confirm_posted',
    'Bestätige dass du einen Draft manuell gepostet hast. Aktiviert Engagement-Tracking und Cooldown-Timer ' +
      'für diese Community.',
    {
      opportunity_id: z.string().uuid(),
      posted_url: z.string().url().optional(),
    },
    async ({ opportunity_id, posted_url }) => {
      try {
        const result = await client.confirmPosted(opportunity_id, posted_url);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'reuse_content',
    'Recycelt einen erfolgreichen Post oder eine bewährte Antwort für eine andere Community mit ' +
      'anderem Blickwinkel. Gib den Original-Text direkt an (nicht nur eine ID).',
    {
      original_content: z.string().min(20).max(20000).describe('Der wiederzuverwendende Text, im Original.'),
      target_community: z.string().min(2).max(100),
      angle_shift: z.string().min(3).max(500).describe('Wie sich der neue Blickwinkel vom Original unterscheidet.'),
      original_post_id: z.string().uuid().optional().describe('post_group_id oder response_map_entry_id, falls bekannt.'),
    },
    async (input) => {
      try {
        const result = await client.reuseContent(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_response_map',
    'Zeigt bewährte Antworten aus deiner Response Map — sortiert nach Engagement.',
    {
      category: z.string().optional().describe('Filtert nach intent_type, z.B. "question" oder "complaint".'),
      limit: z.number().int().min(1).max(50).default(10).optional(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const result = await client.getResponseMap(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'add_response_map_entry',
    'Speichert eine erfolgreiche Antwort in deiner Response Map für zukünftige Wiederverwendung.',
    {
      question_pattern: z.string().min(3).max(500).describe('Welche Frage/welches Muster diese Antwort beantwortet.'),
      best_answer: z.string().min(10).max(10000).describe('Die bewährte Antwort selbst.'),
      intent_type: z.enum(['question', 'comparison', 'recommendation', 'complaint', 'discussion']).optional(),
      proof_asset_url: z.string().url().optional().describe('Link zu einem Beleg (Demo, Doku, Screenshot).'),
    },
    async (input) => {
      try {
        const result = await client.addResponseMapEntry(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_voice_config',
    'Zeigt deine aktuelle Brand-Voice-Konfiguration für Reply-Drafts.',
    {},
    { readOnlyHint: true },
    async () => {
      try {
        const result = await client.getVoiceConfig();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'update_voice_config',
    'Passt deine Brand-Voice an. Beeinflusst wie Reply-Drafts (draft_reply) formuliert werden.',
    {
      tone: VOICE_TONE.optional(),
      avoid_patterns: z.array(z.string().max(100)).max(20).optional(),
      example_replies: z.array(z.string().max(2000)).max(10).optional(),
      language: z.enum(['de', 'en']).optional(),
    },
    { idempotentHint: true },
    async (input) => {
      try {
        const result = await client.updateVoiceConfig(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
