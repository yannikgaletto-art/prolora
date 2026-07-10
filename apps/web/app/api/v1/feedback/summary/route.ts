import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CREDIT_COSTS, type FeedbackSentiment } from '@prolora/shared';
import { getWorkspaceId } from '@/lib/api/auth-middleware';
import { handleRouteError, jsonError } from '@/lib/api/http';
import { getServiceDb, type FeedbackItemRow } from '@/lib/db';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';

const MAX_ROWS = 2000;

const summaryQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d']).default('30d'),
  include_ai_summary: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
});

type SummaryRow = Pick<
  FeedbackItemRow,
  | 'sentiment'
  | 'sentiment_score'
  | 'category'
  | 'source_platform'
  | 'topics'
  | 'urgency'
  | 'status'
  | 'summary_en'
  | 'is_duplicate'
  | 'created_at'
>;

// GET /api/v1/feedback/summary — aggregated stats + AI executive summary
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const workspaceId = await getWorkspaceId(req);
    const query = summaryQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const days = query.period === '7d' ? 7 : query.period === '30d' ? 30 : 90;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = getServiceDb();
    const { data, error } = await db
      .from('feedback_items')
      .select(
        'sentiment, sentiment_score, category, source_platform, topics, urgency, status, summary_en, is_duplicate, created_at'
      )
      .eq('workspace_id', workspaceId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS)
      .returns<SummaryRow[]>();

    if (error) {
      console.error('[feedback/summary] query failed:', error.message);
      return jsonError(500, 'Could not load feedback summary.', 'query_failed');
    }

    const items = (data ?? []).filter((item) => !item.is_duplicate);

    const bySentiment: Record<FeedbackSentiment, number> = {
      positive: 0,
      negative: 0,
      neutral: 0,
      mixed: 0,
    };
    const byCategory: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byDay = new Map<string, { total: number; count: number }>();
    const topicStats = new Map<string, { count: number; scoreTotal: number }>();
    let urgentUnresolved = 0;

    for (const item of items) {
      if (item.sentiment) bySentiment[item.sentiment] += 1;
      if (item.category) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      byPlatform[item.source_platform] = (byPlatform[item.source_platform] ?? 0) + 1;

      if (item.sentiment_score !== null) {
        const day = item.created_at.slice(0, 10);
        const entry = byDay.get(day) ?? { total: 0, count: 0 };
        entry.total += Number(item.sentiment_score);
        entry.count += 1;
        byDay.set(day, entry);
      }

      for (const topic of item.topics ?? []) {
        const stat = topicStats.get(topic) ?? { count: 0, scoreTotal: 0 };
        stat.count += 1;
        stat.scoreTotal += Number(item.sentiment_score ?? 0);
        topicStats.set(topic, stat);
      }

      if (
        (item.urgency === 'critical' || item.urgency === 'high') &&
        (item.status === 'new' || item.status === 'reviewed')
      ) {
        urgentUnresolved += 1;
      }
    }

    const sentimentTrend = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { total, count }]) => ({
        date,
        avg_score: Number((total / count).toFixed(2)),
        count,
      }));

    const topTopics = [...topicStats.entries()]
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([topic, stat]) => ({
        topic,
        count: stat.count,
        avg_sentiment: Number((stat.scoreTotal / stat.count).toFixed(2)),
      }));

    let aiExecutiveSummary = '';
    if (query.include_ai_summary && items.length > 0) {
      aiExecutiveSummary = await generateExecutiveSummary(workspaceId, {
        period: query.period,
        total: items.length,
        bySentiment,
        byCategory,
        topTopics: topTopics.slice(0, 5),
        urgentUnresolved,
        recentSummaries: items
          .map((i) => i.summary_en)
          .filter((s): s is string => Boolean(s))
          .slice(0, 30),
      });
    }

    return NextResponse.json({
      period: query.period,
      total_feedback: items.length,
      by_sentiment: bySentiment,
      by_category: byCategory,
      by_platform: byPlatform,
      sentiment_trend: sentimentTrend,
      top_topics: topTopics,
      urgent_unresolved: urgentUnresolved,
      ai_executive_summary: aiExecutiveSummary,
    });
  } catch (error) {
    return handleRouteError('v1/feedback/summary GET', error);
  }
}

interface SummaryInput {
  period: string;
  total: number;
  bySentiment: Record<string, number>;
  byCategory: Record<string, number>;
  topTopics: Array<{ topic: string; count: number; avg_sentiment: number }>;
  urgentUnresolved: number;
  recentSummaries: string[];
}

// Executive summary is best-effort: an Anthropic outage degrades to an
// empty string, never to a failed endpoint.
async function generateExecutiveSummary(workspaceId: string, input: SummaryInput): Promise<string> {
  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      system:
        'You write executive summaries of customer feedback for a product team. ' +
        '3-5 sentences: overall mood, the dominant themes, and the single most important action. ' +
        'Write in German.',
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(' ')
      .trim();

    const db = getServiceDb();
    const { error } = await db.from('usage_logs').insert({
      workspace_id: workspaceId,
      action: 'executive_summary',
      credits_used: CREDIT_COSTS.executive_summary,
      metadata: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
    if (error) console.error('[feedback/summary] usage log failed:', error.message);

    return text;
  } catch (error) {
    console.error('[feedback/summary] AI summary failed:', error);
    return '';
  }
}
