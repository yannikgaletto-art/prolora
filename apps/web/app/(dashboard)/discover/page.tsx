import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getCommunities } from '@/lib/discovery/list-communities';
import { Card } from '@/app/components/Card';
import { Badge } from '@/app/components/Badge';
import { EmptyState } from '@/app/components/EmptyState';
import { AddCommunitiesButton } from './AddCommunitiesButton';
import { getSystemStatus } from '@/lib/system/doctor';

export const metadata: Metadata = { title: 'Discover — Prolora' };

const memberFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' });
const scoreFormatter = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });

// Server Component (F0-4, Pfad A): reads discovery_communities through the
// service layer directly — never by fetch()-ing our own /api/v1 route.
export default async function DiscoverPage() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.getUser(); // session already validated by the dashboard layout
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const [communities, systemStatus] = await Promise.all([
    getCommunities(workspace.id),
    getSystemStatus(workspace.id),
  ]);
  const discoveryState = systemStatus.features.discovery;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Discover</h1>
          <p className="mt-1 text-sm text-gray-500">
            Communities where your product&apos;s audience already hangs out. Thread Radar scans
            them on its own schedule — new opportunities show up under Opportunities.
          </p>
        </div>
        {communities.length > 0 && <AddCommunitiesButton featureState={discoveryState} />}
      </div>

      {communities.length === 0 ? (
        <EmptyState
          title="No communities mapped yet"
          description="Describe your product and target audience to find relevant communities and their posting rules."
          action={<AddCommunitiesButton featureState={discoveryState} />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {communities.map((community) => (
            <Card
              key={community.id}
              title={community.community_name}
              description={community.community_url ?? undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="gray">{community.platform}</Badge>
                {community.activity_level && <Badge status={community.activity_level} />}
                {typeof community.relevance_score === 'number' && (
                  <Badge tone="teal">{scoreFormatter.format(community.relevance_score)} match</Badge>
                )}
                {!community.is_active && <Badge tone="gray">Inactive</Badge>}
              </div>

              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Members</dt>
                  <dd className="font-medium text-gray-900">
                    {community.member_count != null
                      ? memberFormatter.format(community.member_count)
                      : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Language</dt>
                  <dd className="font-medium text-gray-900">{community.language}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Posts this week</dt>
                  <dd className="font-medium text-gray-900">{community.posts_this_week}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Posting cooldown</dt>
                  <dd className="font-medium text-gray-900">
                    {community.posting_cooldown_days} {community.posting_cooldown_days === 1 ? 'day' : 'days'}
                  </dd>
                </div>
              </dl>

              {community.recommended_approach && (
                <p className="mt-4 border-t border-gray-100 pt-3 text-sm text-gray-600">
                  {community.recommended_approach}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
