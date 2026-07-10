import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import {
  getFeedbackSummary,
  type FeedbackSummaryPeriod,
} from '@/lib/feedback/feedback-summary';
import { StatCard } from '@/app/components/Card';
import { Badge } from '@/app/components/Badge';
import { EmptyState } from '@/app/components/EmptyState';

const PERIODS: { value: FeedbackSummaryPeriod; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPeriod(value: string | undefined): value is FeedbackSummaryPeriod {
  return value === '7d' || value === '30d' || value === '90d';
}

function trendBarColor(avgScore: number): string {
  if (avgScore > 0.15) return 'bg-green-500';
  if (avgScore < -0.15) return 'bg-red-500';
  return 'bg-amber-500';
}

export default async function ListenSummaryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const period = isPeriod(first(params.period)) ? (first(params.period) as FeedbackSummaryPeriod) : '30d';

  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);

  if (!workspace) {
    return (
      <EmptyState title="No workspace found" description="Sign in again to load your feedback." />
    );
  }

  const summary = await getFeedbackSummary(workspace.id, period);

  const positiveShare =
    summary.total_feedback > 0
      ? Math.round((summary.by_sentiment.positive / summary.total_feedback) * 100)
      : null;

  const maxWeeklyCount = Math.max(1, ...summary.sentiment_trend_weekly.map((w) => w.count));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/listen"
            className="text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            ← Back to Listen
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-gray-900">Executive summary</h1>
          <p className="text-sm text-gray-500">
            Numeric rollup of feedback collected over the last {period.replace('d', '')} days.
          </p>
        </div>
        <div className="flex gap-1 rounded-md bg-gray-100 p-1">
          {PERIODS.map((p) => (
            <Link
              key={p.value}
              href={`/listen/summary?period=${p.value}`}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                p.value === period
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </header>

      {summary.total_feedback === 0 ? (
        <EmptyState
          title="No feedback in this period"
          description="Once feedback comes in from your connected sources, an executive rollup will appear here."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total feedback" value={summary.total_feedback} />
            <StatCard
              label="Urgent unresolved"
              value={summary.urgent_unresolved}
              hint="High/critical urgency, not yet actioned"
            />
            <StatCard
              label="Positive sentiment"
              value={positiveShare !== null ? `${positiveShare}%` : '—'}
              hint={`${summary.by_sentiment.positive} of ${summary.total_feedback} items`}
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
            <p className="text-sm font-medium text-gray-900">Weekly sentiment trend</p>
            <p className="text-xs text-gray-500">
              Bar height is feedback volume that week; color is the average sentiment.
            </p>
            {summary.sentiment_trend_weekly.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500">Not enough data yet.</p>
            ) : (
              <div className="mt-5 flex h-32 items-end gap-2 overflow-x-auto">
                {summary.sentiment_trend_weekly.map((week) => (
                  <div
                    key={week.week_start}
                    className="flex min-w-[2.5rem] flex-1 flex-col items-center gap-1.5"
                  >
                    <div className="flex h-24 w-full items-end">
                      <div
                        className={`w-full rounded-t ${trendBarColor(week.avg_score)}`}
                        style={{ height: `${Math.max(6, (week.count / maxWeeklyCount) * 100)}%` }}
                        title={`${week.label}: ${week.count} items, avg score ${week.avg_score}`}
                      />
                    </div>
                    <span className="text-[11px] text-gray-500">{week.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
              <p className="text-sm font-medium text-gray-900">Top topics</p>
              {summary.top_topics.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No topics extracted yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {summary.top_topics.map((topic) => (
                    <li key={topic.topic} className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-gray-800">{topic.topic}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-gray-400">{topic.count}×</span>
                        <Badge
                          tone={
                            topic.avg_sentiment > 0.15
                              ? 'green'
                              : topic.avg_sentiment < -0.15
                                ? 'red'
                                : 'gray'
                          }
                        >
                          {topic.avg_sentiment.toFixed(2)}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
              <p className="text-sm font-medium text-gray-900">Feature request ranking</p>
              {summary.top_feature_requests.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No feature requests in this period.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {summary.top_feature_requests.map((request, index) => (
                    <li key={`${request.summary}-${index}`} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-gray-800">{request.summary}</p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {request.sources.join(', ')}
                        </p>
                      </div>
                      <Badge tone="teal" className="shrink-0">
                        {request.count}×
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
