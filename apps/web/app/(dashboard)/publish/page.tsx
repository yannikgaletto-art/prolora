import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getConnectionsWithCharacterLimits } from '@/lib/connections/list-connections';
import { getDict } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { PublishTabs } from './PublishTabs';
import { PostComposer } from './PostComposer';

export const metadata: Metadata = { title: 'Publish — Prolora' };

// Server Component (F0-4, Pfad A): reads connections through the lib/
// service layer directly, never by fetch()-ing our own /api/v1/connections.
export default async function PublishPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [connections, locale] = await Promise.all([
    getConnectionsWithCharacterLimits(workspace.id),
    getLocale(),
  ]);
  const dict = getDict(locale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Publish</h1>
        <p className="mt-1 text-sm text-gray-500">
          Write once, publish everywhere you&apos;re connected.
        </p>
      </div>
      <PublishTabs active="compose" />
      <PostComposer
        connections={connections}
        wizardStrings={{
          entryButton: dict.entry_button,
          entryPromise: dict.entry_promise,
          toastApplied: dict.toast_applied,
          toastExpired: dict.toast_expired,
        }}
      />
    </div>
  );
}
