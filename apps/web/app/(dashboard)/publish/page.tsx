import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getConnectionsWithCharacterLimits } from '@/lib/connections/list-connections';
import { getLocale } from '@/lib/i18n/server';
import { getSystemStatus } from '@/lib/system/doctor';
import { PublishTabs } from './PublishTabs';
import { OnePath } from './OnePath';

export const metadata: Metadata = { title: 'Publish — Prolora' };

// GOAL-RUN11 One Path: /publish is the single main path (say → review → post).
// The former card composer (PostComposer.tsx) survives as the parts bin for
// the review state's inline editors; the guided RUN9 flow stays at
// /publish/start behind the Werkzeuge menu.
// Server Component (F0-4, Pfad A): reads through lib/, never own API routes.
export default async function PublishPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [connections, locale, systemStatus] = await Promise.all([
    getConnectionsWithCharacterLimits(workspace.id),
    getLocale(),
    getSystemStatus(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PublishTabs active="compose" locale={locale} />
      <OnePath
        connections={connections}
        locale={locale}
        mediaFeature={systemStatus.features.media_generation}
      />
    </div>
  );
}
