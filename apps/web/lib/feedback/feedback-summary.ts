import { getServiceDb, type FeedbackItemRow } from '@/lib/db';
import type { FeedbackSentiment } from '@prolora/shared';

// Read path for Server Components (F2 - Listen). Mirrors the numeric
// aggregation built by GET /api/v1/feedback/summary
// (app/api/v1/feedback/summary/route.ts): same period window, same
// duplicate-exclusion rule, same per-sentiment/category/platform/topic
// tallies, same "urgent unresolved" definition.
//
// Deliberate deviation: this file does NOT call the Anthropic executive-
// summary path. That call is a live, credit-metered AI request
// (usage_logs insert + CREDIT_COSTS.executive_summary) which is fine to pay
// once when a user explicitly asks for a text summary via the API, but not
// on every uncached Server Component render of a dashboard page. The page
// built on top of this file shows the numeric aggregates instead of
// re-deriving that AI paragraph.
//
// Addition beyond the route: a Monday-based weekly sentiment bucket
// (`sentiment_trend_weekly`) and a feature-request ranking
// (`top_feature_requests`, matching the shape already declared in
// packages/shared/types.ts FeedbackSummaryResponse but never populated by
// the route) — both needed by app/(dashboard)/listen/summary/page.tsx.

const MAX_ROWS = 2000;

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

export type FeedbackSummaryPeriod = '7d' | '30d' | '90d';

const PERIOD_DAYS: Record<FeedbackSummaryPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

export interface SentimentTrendPoint {
  date: string;
  avg_score: number;
  count: number;
}

export interface WeeklySentimentBucket {
  /** ISO date (Monday, UTC) of the week start — sorts naturally. */
  week_start: string;
  /** Short human label, e.g. "Jun 30". */
  label: string;
  avg_score: number;
  count: number;
}

export interface TopTopic {
  topic: string;
  count: number;
  avg_sentiment: number;
}

export interface TopFeatureRequest {
  summary: string;
  count: number;
  sources: string[];
}

export interface FeedbackSummary {
  period: FeedbackSummaryPeriod;
  total_feedback: number;
  by_sentiment: Record<FeedbackSentiment, number>;
  by_category: Record<string, number>;
  by_platform: Record<string, number>;
  sentiment_trend: SentimentTrendPoint[];
  sentiment_trend_weekly: WeeklySentimentBucket[];
  top_topics: TopTopic[];
  top_feature_requests: TopFeatureRequest[];
  urgent_unresolved: number;
}

// Monday-based week start, UTC, plain Date math (no date-fns available).
function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const sinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return d;
}

const weekLabelFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export async function getFeedbackSummary(
  workspaceId: string,
  period: FeedbackSummaryPeriod = '30d'
): Promise<FeedbackSummary> {
  const days = PERIOD_DAYS[period];
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
    throw new Error(`[feedback] summary query failed: ${error.message}`);
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
  const byWeek = new Map<string, { total: number; count: number }>();
  const topicStats = new Map<string, { count: number; scoreTotal: number }>();
  const featureRequestStats = new Map<string, { count: number; sources: Set<string> }>();
  let urgentUnresolved = 0;

  for (const item of items) {
    if (item.sentiment) bySentiment[item.sentiment] += 1;
    if (item.category) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    byPlatform[item.source_platform] = (byPlatform[item.source_platform] ?? 0) + 1;

    if (item.sentiment_score !== null) {
      const day = item.created_at.slice(0, 10);
      const dayEntry = byDay.get(day) ?? { total: 0, count: 0 };
      dayEntry.total += Number(item.sentiment_score);
      dayEntry.count += 1;
      byDay.set(day, dayEntry);

      const weekKey = weekStart(new Date(item.created_at)).toISOString().slice(0, 10);
      const weekEntry = byWeek.get(weekKey) ?? { total: 0, count: 0 };
      weekEntry.total += Number(item.sentiment_score);
      weekEntry.count += 1;
      byWeek.set(weekKey, weekEntry);
    }

    for (const topic of item.topics ?? []) {
      const stat = topicStats.get(topic) ?? { count: 0, scoreTotal: 0 };
      stat.count += 1;
      stat.scoreTotal += Number(item.sentiment_score ?? 0);
      topicStats.set(topic, stat);
    }

    if (item.category === 'feature_request') {
      const key = item.topics?.[0] ?? item.summary_en?.slice(0, 80) ?? 'Uncategorized';
      const stat = featureRequestStats.get(key) ?? { count: 0, sources: new Set<string>() };
      stat.count += 1;
      stat.sources.add(item.source_platform);
      featureRequestStats.set(key, stat);
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

  const sentimentTrendWeekly = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, { total, count }]) => ({
      week_start: week,
      label: weekLabelFormatter.format(new Date(`${week}T00:00:00Z`)),
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

  const topFeatureRequests = [...featureRequestStats.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 10)
    .map(([summary, stat]) => ({
      summary,
      count: stat.count,
      sources: [...stat.sources],
    }));

  return {
    period,
    total_feedback: items.length,
    by_sentiment: bySentiment,
    by_category: byCategory,
    by_platform: byPlatform,
    sentiment_trend: sentimentTrend,
    sentiment_trend_weekly: sentimentTrendWeekly,
    top_topics: topTopics,
    top_feature_requests: topFeatureRequests,
    urgent_unresolved: urgentUnresolved,
  };
}
