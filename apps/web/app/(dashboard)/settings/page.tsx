import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { listApiKeys } from '@/lib/settings/api-keys';
import { SettingsTabs } from './SettingsTabs';
import { WorkspaceSection } from './WorkspaceSection';
import { ApiKeysPanel } from './ApiKeysPanel';
import { WebhooksPanel } from './WebhooksPanel';
import { PlanSection } from './PlanSection';
import { SystemStatusSection } from './SystemStatusSection';
import { getLocale } from '@/lib/i18n/server';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { CreatorStyleSection } from './CreatorStyleSection';

export const metadata: Metadata = { title: 'Settings — Prolora' };

// Server Component shell (F0-4, Pfad A): every read here goes through a lib/
// service function against the service-role db, never through fetch() at our
// own API. The Webhooks tab is the one exception by design — it has a real
// route, so its 'use client' island (WebhooksPanel) talks to it via the
// client-side API helper instead.
export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const [apiKeys, locale, context] = await Promise.all([
    listApiKeys(workspace.id),
    getLocale(),
    getWorkspaceContext(workspace.id),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your workspace, API access and integrations.
        </p>
      </div>

      <SettingsTabs
        workspaceTab={
          <div className="space-y-4">
            <WorkspaceSection name={workspace.name} slug={workspace.slug} />
            <CreatorStyleSection initialStyle={context?.creator_style ?? 'neutral'} locale={locale} />
          </div>
        }
        apiKeysTab={<ApiKeysPanel workspaceId={workspace.id} initialKeys={apiKeys} />}
        webhooksTab={<WebhooksPanel workspaceId={workspace.id} />}
        planTab={<PlanSection workspaceId={workspace.id} locale={locale} />}
        systemTab={<SystemStatusSection workspaceId={workspace.id} locale={locale} />}
      />
    </div>
  );
}
