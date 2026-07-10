import Link from 'next/link';
import type { FeedbackCategory, FeedbackSentiment, FeedbackUrgency } from '@prolora/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getFeedbackItems, type FeedbackListFilters } from '@/lib/feedback/list-feedback';
import { getFeedbackSummary } from '@/lib/feedback/feedback-summary';
import { StatCard } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';
import { FeedbackFilterBar } from './FeedbackFilterBar';
import { FeedbackPagination } from './FeedbackPagination';
import { FeedbackRow } from './FeedbackRow';
import { SentimentDistribution } from './SentimentDistribution';

const SENTIMENT_VALUES: FeedbackSentiment[] = ['positive', 'negative', 'neutral', 'mixed'];
const CATEGORY_VALUES: FeedbackCategory[] = [
  'bug',
  'feature_request',
  'praise',
  'complaint',
  'question',
  'other',
];
const URGENCY_VALUES: FeedbackUrgency[] = ['low', 'medium', 'high', 'critical'];

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pickEnum<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function ListenPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);

  // Layout already redirects unauthenticated / workspace-less requests —
  // this is a defensive fallback, not the primary guard.
  if (!workspace) {
    return (
      <EmptyState title="No workspace found" description="Sign in again to load your feedback." />
    );
  }

  const page = Number(first(params.page));
  const isDuplicateRaw = first(params.is_duplicate);

  const filters: FeedbackListFilters = {
    platform: first(params.platform)?.trim() || undefined,
    sentiment: pickEnum(first(params.sentiment), SENTIMENT_VALUES),
    category: pickEnum(first(params.category), CATEGORY_VALUES),
    urgency: pickEnum(first(params.urgency), URGENCY_VALUES),
    is_duplicate: isDuplicateRaw === 'true' ? true : isDuplicateRaw === 'false' ? false : undefined,
    search: first(params.search)?.trim() || undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    per_page: 20,
  };

  const [list, summary] = await Promise.all([
    getFeedbackItems(workspace.id, filters),
    getFeedbackSummary(workspace.id, '30d'),
  ]);

  const topTopic = summary.top_topics[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Listen</h1>
          <p className="text-sm text-gray-500">
            Feedback collected across your connected sources, analyzed automatically.
          </p>
        </div>
        <Link
          href="/listen/summary"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50"
        >
          Executive summary
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total feedback (30d)" value={summary.total_feedback} />
        <StatCard
          label="Urgent unresolved"
          value={summary.urgent_unresolved}
          hint="High/critical urgency, not yet actioned"
        />
        <StatCard
          label="Top topic"
          value={topTopic ? topTopic.topic : '—'}
          hint={topTopic ? `${topTopic.count} mentions` : 'No topics yet'}
        />
      </div>

      <SentimentDistribution bySentiment={summary.by_sentiment} />

      <FeedbackFilterBar />

      {list.items.length === 0 ? (
        <EmptyState
          title="No feedback matches these filters"
          description="Try widening your filters, or check back once new feedback comes in from your connected sources."
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {list.items.map((item) => (
              <FeedbackRow key={item.id} item={item} />
            ))}
          </ul>
          <FeedbackPagination page={list.page} perPage={list.per_page} total={list.total} />
        </div>
      )}
    </div>
  );
}
