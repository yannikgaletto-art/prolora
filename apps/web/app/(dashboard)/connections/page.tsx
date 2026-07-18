import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getConnections } from '@/lib/connections/list-connections';
import { ConnectionsView } from './ConnectionsView';
import { getSystemStatus } from '@/lib/system/doctor';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Connections — Prolora' };

// Server Component (F0-4, Pfad A): reads data through the lib/ service layer
// directly, never by fetch()-ing our own /api/v1/connections route.
export default async function ConnectionsPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [connections, systemStatus, locale] = await Promise.all([
    getConnections(workspace.id),
    getSystemStatus(workspace.id),
    getLocale(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Connections</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect the accounts Prolora publishes to and listens on.
        </p>
      </div>
      <ConnectionsView
        initialConnections={connections}
        locale={locale}
        connectStates={{
          linkedin: systemStatus.features.connect_linkedin,
          x: systemStatus.features.connect_x,
        }}
      />
    </div>
  );
}
