import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getConnections } from '@/lib/connections/list-connections';
import { ConnectionsView } from './ConnectionsView';

export const metadata: Metadata = { title: 'Connections — Prolora' };

// Server Component (F0-4, Pfad A): reads data through the lib/ service layer
// directly, never by fetch()-ing our own /api/v1/connections route.
export default async function ConnectionsPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const connections = await getConnections(workspace.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Connections</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect the accounts Prolora publishes to and listens on.
        </p>
      </div>
      <ConnectionsView initialConnections={connections} />
    </div>
  );
}
