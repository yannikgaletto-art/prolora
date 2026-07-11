import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PLAN_LIMITS, type PlanType } from '@prolora/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getConnectionsWithCharacterLimits } from '@/lib/connections/list-connections';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { getServiceDb } from '@/lib/db';
import { getDict } from '@/lib/i18n';
import { getLocale } from '@/lib/i18n/server';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import { TemplateGuide } from './TemplateGuide';

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

  const [connections, context, locale] = await Promise.all([
    getConnectionsWithCharacterLimits(workspace.id),
    getWorkspaceContext(workspace.id),
    getLocale(),
  ]);

  const db = getServiceDb();
  const { data: planRow } = await db
    .from('workspaces')
    .select('plan')
    .eq('id', workspace.id)
    .single<{ plan: PlanType }>();
  const aiEnabled = planRow ? (PLAN_LIMITS[planRow.plan]?.ai_credits ?? 0) > 0 : false;

  const templates = TEMPLATE_CATALOG.map(({ prompt_hints: _promptHints, ...summary }) => summary);

  return (
    // Suspense around the useSearchParams consumer: harmless today (the page
    // is dynamic), mandatory the day this route goes static/PPR.
    <Suspense fallback={null}>
      <TemplateGuide
        templates={templates}
        connections={connections}
        contextAvailable={context !== null}
        aiEnabled={aiEnabled}
        workspaceId={workspace.id}
        locale={locale}
        dict={getDict(locale)}
      />
    </Suspense>
  );
}
