import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getCommunities } from '@/lib/discovery/list-communities';
import { EmptyState } from '@/app/components/EmptyState';
import { AddCommunitiesButton } from './AddCommunitiesButton';
import { CommunityGrid } from './CommunityGrid';
import { ProviderStrip } from './ProviderStrip';
import { listDiscoveryProviderStatuses } from '@/lib/discovery/providers';
import { getSystemStatus } from '@/lib/system/doctor';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Discover — Prolora' };

// Server Component (F0-4, Pfad A): reads discovery_communities through the
// service layer directly — never by fetch()-ing our own /api/v1 route.
//
// The "connect Reddit first" gate is gone: Mastodon and Hacker News need no
// credentials, so an empty Discover page is now an empty *result*, not a locked
// door. Whether Reddit is set up is one row in the platform strip, not the
// state of the whole feature.
export default async function DiscoverPage() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.getUser(); // session already validated by the dashboard layout
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const locale = await getLocale();
  const [communities, systemStatus, providers] = await Promise.all([
    getCommunities(workspace.id),
    getSystemStatus(workspace.id, locale),
    listDiscoveryProviderStatuses(workspace.id),
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
        {communities.length > 0 && (
          <AddCommunitiesButton featureState={discoveryState} initialProviders={providers} />
        )}
      </div>

      <ProviderStrip providers={providers} />

      {communities.length === 0 ? (
        <EmptyState
          title="No communities mapped yet"
          description="Describe your product and target audience to find relevant communities and their posting rules. Mastodon and Hacker News work without any setup."
          action={
            <AddCommunitiesButton featureState={discoveryState} initialProviders={providers} />
          }
        />
      ) : (
        <CommunityGrid communities={communities} />
      )}
    </div>
  );
}
