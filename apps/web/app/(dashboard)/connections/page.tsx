import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getConnections } from '@/lib/connections/list-connections';
import { getConnectionHealth } from '@/lib/connections/health';
import { getChannelCapacity } from '@/lib/connections/capacity';
import { ConnectionsView } from './ConnectionsView';
import { byoRedirectUri, oauthAppProvider, oauthPlatformLabel } from '@/lib/auth/byo-oauth';
import { getIntegrationStatus } from '@/lib/integrations/credentials';
import type { OAuthAppStatusDto } from '@/lib/connections/registry';
import { getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = { title: 'Connections — Prolora' };

// Server Component (F0-4, Pfad A): reads data through the lib/ service layer
// directly, never by fetch()-ing our own /api/v1/connections route.
export default async function ConnectionsPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [connections, health, capacity, linkedinApp, xApp, locale] = await Promise.all([
    getConnections(workspace.id),
    getConnectionHealth(workspace.id),
    getChannelCapacity(workspace.id),
    oauthAppStatus(workspace.id, 'linkedin'),
    oauthAppStatus(workspace.id, 'x'),
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
        health={health}
        capacity={capacity}
        oauthApps={{ linkedin: linkedinApp, x: xApp }}
        locale={locale}
      />
    </div>
  );
}

// Mirrors GET /api/v1/connections/oauth-app/{platform} so the first paint needs
// no client fetch. Never carries the secret — only the status shape does.
async function oauthAppStatus(
  workspaceId: string,
  platform: 'linkedin' | 'x'
): Promise<OAuthAppStatusDto> {
  const status = await getIntegrationStatus(workspaceId, oauthAppProvider(platform));
  return {
    platform,
    label: oauthPlatformLabel(platform),
    redirect_uri: byoRedirectUri(platform),
    connected: status.connected,
    source: status.source,
    clientIdHint: status.clientIdHint,
    verifiedAt: status.verifiedAt,
    lastError: status.lastError,
  };
}
