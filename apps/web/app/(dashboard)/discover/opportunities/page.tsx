import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getOpportunities } from '@/lib/discovery/list-opportunities';
import { getCommunities } from '@/lib/discovery/list-communities';
import { Card } from '@/app/components/Card';
import { Badge, type BadgeTone } from '@/app/components/Badge';
import { EmptyState } from '@/app/components/EmptyState';
import type { OpportunityThreadRow } from '@/lib/db';
import { OpportunityFilters } from './OpportunityFilters';
import { OpportunityPagination } from './OpportunityPagination';
import { OpportunityActions } from './OpportunityActions';
import { getSystemStatus } from '@/lib/system/doctor';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Opportunities — Prolora' };

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const scoreFormatter = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

const STATUS_TONE: Record<OpportunityThreadRow['status'], BadgeTone> = {
  new: 'gray',
  drafted: 'blue',
  posted: 'green',
  skipped: 'gray',
  expired: 'red',
};

const VALID_STATUSES: OpportunityThreadRow['status'][] = [
  'new',
  'drafted',
  'posted',
  'skipped',
  'expired',
];

function isOpportunityStatus(value: string | undefined): value is OpportunityThreadRow['status'] {
  return (VALID_STATUSES as string[]).includes(value ?? '');
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

interface OpportunitiesPageProps {
  searchParams: Promise<{ status?: string; community?: string; page?: string }>;
}

// Server Component (F0-4, Pfad A): reads opportunity_threads through the
// service layer directly — never by fetch()-ing our own /api/v1 route.
export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.getUser(); // session already validated by the dashboard layout
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const params = await searchParams;
  const status = isOpportunityStatus(params.status) ? params.status : undefined;
  const page = params.page ? Math.max(1, parseInt(params.page, 10) || 1) : 1;

  const [communities, result, systemStatus, locale] = await Promise.all([
    getCommunities(workspace.id),
    getOpportunities(workspace.id, {
      status,
      community: params.community || undefined,
      page,
    }),
    getSystemStatus(workspace.id),
    getLocale(),
  ]);

  const communityOptions = communities.map((community) => ({
    value: community.community_name,
    label: community.community_name,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Opportunities</h1>
        <p className="mt-1 text-sm text-gray-500">
          Threads worth replying to, ranked by relevance. New ones arrive on Thread Radar&apos;s
          own schedule.
        </p>
      </div>

      <Suspense fallback={null}>
        <OpportunityFilters communityOptions={communityOptions} />
      </Suspense>

      {result.opportunities.length === 0 ? (
        <EmptyState
          title="No opportunities yet"
          description="Thread Radar scans your mapped communities on its own schedule. Check back soon, or map more communities to widen the net."
        />
      ) : (
        <div className="space-y-4">
          {result.opportunities.map((opportunity) => (
            <Card key={opportunity.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={opportunity.thread_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-gray-900 hover:text-primary-700"
                  >
                    {opportunity.thread_title}
                  </a>
                  <p className="mt-1 text-sm text-gray-500">
                    {opportunity.community_name} ·{' '}
                    {dateFormatter.format(new Date(opportunity.created_at))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge status={opportunity.status} tone={STATUS_TONE[opportunity.status]} />
                  {opportunity.intent_type && (
                    <Badge tone="teal">{humanize(opportunity.intent_type)}</Badge>
                  )}
                  {typeof opportunity.relevance_score === 'number' && (
                    <Badge tone="gray">
                      {scoreFormatter.format(opportunity.relevance_score)} relevant
                    </Badge>
                  )}
                </div>
              </div>

              {opportunity.suggested_angle && (
                <p className="mt-3 text-sm text-gray-600">{opportunity.suggested_angle}</p>
              )}

              <div className="mt-4">
                <OpportunityActions
                  opportunityId={opportunity.id}
                  status={opportunity.status}
                  initialDraft={opportunity.draft_content}
                  aiState={systemStatus.features.ai_drafts}
                  locale={locale}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Suspense fallback={null}>
        <OpportunityPagination page={result.page} perPage={result.perPage} total={result.total} />
      </Suspense>
    </div>
  );
}
