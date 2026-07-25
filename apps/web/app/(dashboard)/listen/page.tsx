import Link from 'next/link';
import type { FeedbackCategory, FeedbackSentiment, FeedbackUrgency } from '@prolora/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getFeedbackItems, type FeedbackListFilters } from '@/lib/feedback/list-feedback';
import { getFeedbackSummary } from '@/lib/feedback/feedback-summary';
import { StatCard } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';
import { FeedbackFilterBar } from './FeedbackFilterBar';
import { FeedbackPagination } from './FeedbackPagination';
import { FeedbackRow } from './FeedbackRow';
import { SentimentDistribution } from './SentimentDistribution';
import { SourceRail, type SourceTile } from './SourceRail';
import { buildWidgetCurl, getFeedbackSources } from '@/lib/feedback/source-setup';
import { getSystemStatus } from '@/lib/system/doctor';
import { getLocale } from '@/lib/i18n/server';
import { getRun7Dict } from '@/lib/i18n/run7';

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
  const workspace = await getActiveWorkspace(supabase);

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

  // Locale first: the system hints are localised, so they must not be built
  // before the language is known (an English dashboard used to show German
  // setup hints because getSystemStatus had no locale to work with).
  const locale = await getLocale();
  const [list, summary, sources, systemStatus] = await Promise.all([
    getFeedbackItems(workspace.id, filters),
    getFeedbackSummary(workspace.id, '30d'),
    getFeedbackSources(workspace.id),
    getSystemStatus(workspace.id, locale),
  ]);

  const dict = getRun7Dict(locale).listen;
  const topTopic = summary.top_topics[0];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const widgetConnected = sources.some((s) => s.source_type === 'widget' && s.status === 'active');
  const redditConnected = sources.some((s) => s.source_type === 'reddit' && s.status === 'active');
  const redditState = systemStatus.features.listen_reddit;

  // One tile per source the user could have: the two the product can poll,
  // plus any platform that actually appears in the data (the API ingest path
  // writes a free-form source_platform). Every platform present in the list is
  // therefore reachable from the rail — which is why the filter bar no longer
  // carries a platform box of its own.
  const tiles: SourceTile[] = [
    {
      key: 'widget',
      platform: 'widget',
      count: summary.by_platform.widget ?? 0,
      status: widgetConnected ? 'connected' : 'not_connected',
    },
    {
      key: 'reddit',
      platform: 'reddit',
      count: summary.by_platform.reddit ?? 0,
      status: redditConnected
        ? 'connected'
        : redditState.state === 'ready'
          ? 'not_connected'
          : 'blocked',
    },
    ...Object.entries(summary.by_platform)
      .filter(([platform]) => platform !== 'widget' && platform !== 'reddit')
      .map(([platform, count]): SourceTile => ({
        key: 'other',
        platform,
        label: platform,
        count,
        status: 'connected',
      })),
  ];

  const hasFilters = Object.keys(params).some((key) => key !== 'page');
  const hasAnyFeedback = list.total > 0 || summary.total_feedback > 0;
  const anySourceConnected = sources.length > 0;

  // Nothing to measure yet: an empty stats grid, an empty chart and a full
  // filter bar stacked above an empty list is four containers saying "0".
  // Collapse them to the rail plus one sentence about the next step.
  if (!hasAnyFeedback && !hasFilters) {
    return (
      <div className="space-y-6">
        <ListenHeader subtitle={dict.subtitle} summaryLabel={dict.executiveSummary} />
        <SourceRail
          locale={locale}
          tiles={tiles}
          total={summary.total_feedback}
          initialWidgetConnected={widgetConnected}
          initialRedditConnected={redditConnected}
          widgetCurl={workspace.slug ? buildWidgetCurl(appUrl, workspace.slug) : null}
          redditState={redditState}
        />
        <EmptyState
          title={anySourceConnected ? dict.emptyWaitingTitle : dict.emptyNoSourceTitle}
          description={anySourceConnected ? dict.emptyWaitingBody : dict.emptyNoSourceBody}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ListenHeader subtitle={dict.subtitle} summaryLabel={dict.executiveSummary} />

      <SourceRail
        locale={locale}
        tiles={tiles}
        total={summary.total_feedback}
        initialWidgetConnected={widgetConnected}
        initialRedditConnected={redditConnected}
        widgetCurl={workspace.slug ? buildWidgetCurl(appUrl, workspace.slug) : null}
        redditState={redditState}
      />

      {/* No "total feedback" tile here: the rail's "all sources" tile already
          carries that number, and printing it twice 200px apart buys nothing.
          These three answer what the rail cannot. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={dict.statUrgent}
          value={summary.urgent_unresolved}
          hint={dict.statUrgentHint}
        />
        <StatCard
          label={dict.statFeatureRequests}
          value={summary.by_category.feature_request ?? 0}
          hint={dict.window30d}
        />
        <StatCard
          label={dict.statTopTopic}
          value={topTopic ? topTopic.topic : '—'}
          hint={topTopic ? `${topTopic.count} ${dict.mentions}` : dict.noTopics}
        />
      </div>

      <SentimentDistribution bySentiment={summary.by_sentiment} locale={locale} />

      <FeedbackFilterBar locale={locale} />

      {list.items.length === 0 ? (
        <EmptyState title={dict.emptyFilteredTitle} description={dict.emptyFilteredBody} />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white">
          <ul className="divide-y divide-gray-100">
            {list.items.map((item) => (
              <FeedbackRow key={item.id} item={item} locale={locale} />
            ))}
          </ul>
          <FeedbackPagination page={list.page} perPage={list.per_page} total={list.total} />
        </div>
      )}
    </div>
  );
}

function ListenHeader({ subtitle, summaryLabel }: { subtitle: string; summaryLabel: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Listen</h1>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
      <Link
        href="/listen/summary"
        className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 transition-colors hover:bg-gray-50"
      >
        {summaryLabel}
      </Link>
    </header>
  );
}
