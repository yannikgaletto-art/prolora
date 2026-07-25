import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getCommunities } from '@/lib/discovery/list-communities';
import { EmptyState } from '@/app/components/EmptyState';
import { AddCommunitiesButton } from './AddCommunitiesButton';
import { CommunityGrid } from './CommunityGrid';
import { getSystemStatus } from '@/lib/system/doctor';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Discover — Prolora' };

// Server Component (F0-4, Pfad A): reads discovery_communities through the
// service layer directly — never by fetch()-ing our own /api/v1 route.
export default async function DiscoverPage() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.getUser(); // session already validated by the dashboard layout
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const locale = await getLocale();
  const [communities, systemStatus] = await Promise.all([
    getCommunities(workspace.id),
    getSystemStatus(workspace.id, locale),
  ]);
  const discoveryState = systemStatus.features.discovery;
  const needsReddit = discoveryState.blocker === 'reddit_missing';

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
          title={needsReddit ? 'Connect Reddit to get started' : 'No communities mapped yet'}
          description={
            needsReddit
              ? 'Community discovery reads Reddit with your own app key. Connecting takes about a minute and only needs to happen once.'
              : 'Describe your product and target audience to find relevant communities and their posting rules.'
          }
          action={<AddCommunitiesButton featureState={discoveryState} />}
        />
      ) : (
        <CommunityGrid communities={communities} />
      )}
    </div>
  );
}
