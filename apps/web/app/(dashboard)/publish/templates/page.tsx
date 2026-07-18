import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getConnectionsWithCharacterLimits } from '@/lib/connections/list-connections';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { getDict } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { localizeCatalog } from '@/lib/templates/localization';
import { TemplateGuide } from './TemplateGuide';
import { getSystemStatus } from '@/lib/system/doctor';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return { title: getDict(locale).page_title };
}

// Server Component (GOAL-RUN5 G2): reads workspace state through the lib/
// service layer (Pfad A — never fetch()-ing our own API). This is the only
// place the wizard touches the raw catalog: prompt_hints are stripped HERE,
// so they never reach the client bundle (Oracle O3).
export default async function TemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [connections, context, locale, systemStatus] = await Promise.all([
    getConnectionsWithCharacterLimits(workspace.id),
    getWorkspaceContext(workspace.id),
    getLocale(),
    getSystemStatus(workspace.id),
  ]);

  const templates = localizeCatalog(TEMPLATE_CATALOG, locale).map(({ prompt_hints: _promptHints, ...summary }) => summary);

  return (
    // Suspense around the useSearchParams consumer: harmless today (the page
    // is dynamic), mandatory the day this route goes static/PPR.
    <Suspense fallback={null}>
      <TemplateGuide
        templates={templates}
        connections={connections}
        contextAvailable={context !== null}
        aiEnabled={systemStatus.features.ai_drafts.state === 'ready'}
        aiFeature={systemStatus.features.ai_drafts}
        creditsLimit={systemStatus.plan.ai_credits_limit}
        creditsUsed={systemStatus.plan.ai_credits_used}
        workspaceId={workspace.id}
        locale={locale}
        dict={getDict(locale)}
      />
    </Suspense>
  );
}
