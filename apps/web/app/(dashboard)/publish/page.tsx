import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import type { AngleSuggestion } from '@prolora/shared';
import { getConnectionsWithCharacterLimits } from '@/lib/connections/list-connections';
import { getLocale } from '@/lib/i18n/server';
import { getSystemStatus } from '@/lib/system/doctor';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { listProofAssets, normalizeProfileFields } from '@/lib/product/profile';
import { listContentReferences } from '@/lib/content/references';
import { suggestAngles } from '@/lib/content/angle-service';
import { PublishTabs } from './PublishTabs';
import { OnePath } from './OnePath';

// "Prolora empfiehlt heute" auf dem Sagen-Screen: deterministisch, 0 Credits
// (RUN9 D7). Nur wenn ein Produktprofil existiert — und ein Fehler hier darf
// den Hauptweg nie verhindern, dann gibt es eben keine Vorschläge.
async function loadSuggestions(workspaceId: string): Promise<AngleSuggestion[]> {
  try {
    const context = await getWorkspaceContext(workspaceId);
    if (!context?.product_description) return [];
    const [proofAssets, references] = await Promise.all([
      listProofAssets(workspaceId),
      listContentReferences(workspaceId),
    ]);
    const profile = normalizeProfileFields(context);
    return suggestAngles({
      goal: 'authority',
      productDescription: context.product_description,
      coreValue: profile.core_value,
      proofAssets,
      references,
      founderPerspective: profile.founder_perspective,
    });
  } catch (error) {
    console.error('[onepath] angle suggestions unavailable:', error);
    return [];
  }
}

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

  const [connections, locale, systemStatus, suggestions] = await Promise.all([
    getConnectionsWithCharacterLimits(workspace.id),
    getLocale(),
    getSystemStatus(workspace.id),
    loadSuggestions(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PublishTabs active="compose" locale={locale} />
      <OnePath
        connections={connections}
        locale={locale}
        mediaFeature={systemStatus.features.media_generation}
        suggestions={suggestions}
      />
    </div>
  );
}
