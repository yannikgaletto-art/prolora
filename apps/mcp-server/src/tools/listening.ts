import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProloraClient } from '../api-client.js';
import { toToolError } from '../errors.js';

export function registerListeningTools(server: McpServer, client: ProloraClient): void {
  server.tool(
    'get_feedback',
    'Zeigt gesammeltes Kundenfeedback als Liste. Filter nach Sentiment, Quelle oder Zeitraum. ' +
      'Nutze wenn: Der User will einzelne Feedback-Einträge sehen. NICHT für Zusammenfassungen (get_feedback_summary), ' +
      'Trends (get_sentiment_trend), Themen (get_top_topics) oder freie Fragen (ask_feedback).',
    {
      sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']).optional(),
      source: z.string().optional().describe('Quell-Plattform, z.B. "trustpilot" oder "manual".'),
      since: z.string().datetime().optional().describe('Nur Feedback ab diesem ISO-Zeitpunkt.'),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    },
    { readOnlyHint: true },
    async (input) => {
      try {
        const result = await client.getFeedback(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_feedback_summary',
    'KI-generierte Zusammenfassung des Feedbacks im gewählten Zeitraum mit Trends und Handlungsempfehlungen. ' +
      'Nutze wenn: Der User will einen kompakten Überblick über einen Zeitraum. NICHT für Einzel-Items (get_feedback) ' +
      'oder eine spezifische freie Frage (ask_feedback).',
    {
      period: z.enum(['7d', '30d', '90d']).default('30d').optional().describe('7d = Woche, 30d = Monat, 90d = Quartal.'),
    },
    {},
    async ({ period }) => {
      try {
        const result = await client.getFeedbackSummary({ period, includeAiSummary: true });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_alerts',
    'Zeigt Feedback mit hoher oder kritischer Dringlichkeit, neueste zuerst — deine Alerts. ' +
      'Hinweis: Die API kennt keinen separaten Gelesen/Ungelesen-Status; jeder Aufruf zeigt den aktuellen Stand.',
    {
      limit: z.number().int().min(1).max(50).default(20).optional(),
    },
    { readOnlyHint: true },
    async ({ limit }) => {
      try {
        const cap = limit ?? 20;
        const [critical, high] = await Promise.all([
          client.getFeedback({ urgency: 'critical', limit: cap }),
          client.getFeedback({ urgency: 'high', limit: cap }),
        ]);
        const merged = [...critical.feedback, ...high.feedback]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, cap);
        return { content: [{ type: 'text', text: JSON.stringify({ alerts: merged, total: merged.length }, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'ask_feedback',
    'Stelle eine Frage in natürlicher Sprache über dein Kundenfeedback. Beispiel: ' +
      '"Was sind die häufigsten Beschwerden diese Woche?" ' +
      'Nutze wenn: Der User stellt eine offene, spezifische Frage. Erster Griff bei Unsicherheit — ' +
      'deckt get_feedback, get_feedback_summary, get_sentiment_trend und get_top_topics im Zweifel funktional mit ab.',
    {
      question: z.string().min(3).max(500).describe('Die Frage, z.B. "Was sagen Kunden über den Preis?"'),
    },
    {},
    async ({ question }) => {
      try {
        const result = await client.askFeedback(question);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_sentiment_trend',
    'Zeigt den Sentiment-Verlauf über die letzten X Tage als Datenpunkte. ' +
      'Nutze wenn: Der User fragt explizit nach einem Verlauf/Graph über Zeit. NICHT für Themen (get_top_topics) ' +
      'oder Einzel-Zitate (get_feedback).',
    {
      days: z.number().int().min(1).max(90).default(30).optional(),
    },
    { readOnlyHint: true },
    async ({ days }) => {
      try {
        const period = daysToPeriod(days ?? 30);
        const result = await client.getFeedbackSummary({ period, includeAiSummary: false });
        return { content: [{ type: 'text', text: JSON.stringify({ period, sentiment_trend: result.sentiment_trend }, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_top_topics',
    'Zeigt die häufigsten Themen im Kundenfeedback. ' +
      'Nutze wenn: Der User fragt nach Themen/Kategorien. NICHT für Sentiment-Verlauf (get_sentiment_trend) ' +
      'oder Einzelfälle (get_feedback).',
    {
      period: z.enum(['week', 'month']).default('month').optional(),
      limit: z.number().int().min(1).max(20).default(10).optional(),
    },
    { readOnlyHint: true },
    async ({ period, limit }) => {
      try {
        const mapped = period === 'week' ? '7d' : '30d';
        const result = await client.getFeedbackSummary({ period: mapped, includeAiSummary: false });
        return { content: [{ type: 'text', text: JSON.stringify({ top_topics: result.top_topics.slice(0, limit ?? 10) }, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'mark_feedback',
    'Markiert ein Feedback-Item als bearbeitet ("reviewed") oder archiviert ("archived"), oder schließt es ' +
      'als erledigt ab ("actioned" — schließt verknüpfte Board-Items). Die API erlaubt nur bestimmte ' +
      'Statusübergänge (new→reviewed→actioned→archived); ein ungültiger Übergang liefert einen Fehler.',
    {
      feedback_id: z.string().uuid(),
      action: z.enum(['reviewed', 'actioned', 'archived']),
    },
    { idempotentHint: true },
    async ({ feedback_id, action }) => {
      try {
        const result = await client.markFeedback(feedback_id, action);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'get_competitors',
    'Zeigt Feedback-Einträge, deren Quelle als "competitor" getaggt ist. ' +
      'Hinweis: Es gibt aktuell keine dedizierte Wettbewerbs-Erkennung — dieses Tool filtert bestehendes ' +
      'Feedback nach source_platform="competitor" und liefert nur Ergebnisse, wenn solches Feedback manuell so importiert wurde.',
    {
      limit: z.number().int().min(1).max(100).default(20).optional(),
    },
    { readOnlyHint: true },
    async ({ limit }) => {
      try {
        const result = await client.getFeedback({ source: 'competitor', limit: limit ?? 20 });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );

  server.tool(
    'export_feedback',
    'Exportiert Feedback als JSON oder CSV (bis zu 200 Einträge, clientseitig aus mehreren Seiten zusammengestellt).',
    {
      format: z.enum(['json', 'csv']).default('json'),
      since: z.string().datetime().optional(),
      sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']).optional(),
    },
    { readOnlyHint: true },
    async ({ format, since, sentiment }) => {
      try {
        const perPage = 100;
        const [page1, page2] = await Promise.all([
          client.getFeedback({ since, sentiment, limit: perPage, page: 1 }),
          client.getFeedback({ since, sentiment, limit: perPage, page: 2 }),
        ]);
        const items = [...page1.feedback, ...page2.feedback];
        const text = format === 'csv' ? toCsv(items) : JSON.stringify(items, null, 2);
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}

function daysToPeriod(days: number): '7d' | '30d' | '90d' {
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  return '90d';
}

function toCsv(items: object[]): string {
  if (items.length === 0) return '';
  const records = items as Array<Record<string, unknown>>;
  const headers = Object.keys(records[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = records.map((item) => headers.map((h) => escape(item[h])).join(','));
  return [headers.join(','), ...rows].join('\n');
}
