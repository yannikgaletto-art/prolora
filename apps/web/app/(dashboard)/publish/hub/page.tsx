import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getServiceDb, type ConnectionRow } from '@/lib/db';
import { PublishTabs } from '../PublishTabs';
import { HubView, type HubConnection } from './HubView';
import { getSystemStatus } from '@/lib/system/doctor';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Content Hub — Prolora' };

// Content Hub (GOAL-RUN6 §12): pillar in -> channel-native splinters out.
// Server Component loads the active connections so the client can map a
// splinter's target platform to a real connection id.
export default async function ContentHubPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const db = getServiceDb();
  const systemStatus = await getSystemStatus(workspace.id);
  const locale = await getLocale();
  const { data } = await db
    .from('platform_connections')
    .select('id, platform, account_name, status')
    .eq('workspace_id', workspace.id)
    .eq('status', 'active')
    .returns<Array<Pick<ConnectionRow, 'id' | 'platform' | 'account_name' | 'status'>>>();

  const connections: HubConnection[] = (data ?? []).map((c) => ({
    id: c.id,
    platform: c.platform,
    account_name: c.account_name,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Content Hub</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ein Pillar-Text — viele kanal-native Posts. Schreiben, diktieren oder Blog-URL importieren.
        </p>
      </div>
      <PublishTabs active="hub" />
      <HubView connections={connections} aiState={systemStatus.features.ai_drafts} locale={locale} />
    </div>
  );
}
