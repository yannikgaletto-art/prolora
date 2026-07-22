import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { getLocale } from '@/lib/i18n/server';
import { getProductCopy } from '@/lib/i18n/product';
import { PublishTabs } from '../PublishTabs';
import { StartFlow } from './StartFlow';

export const metadata: Metadata = { title: 'Start — Prolora' };

// Product-to-post entry (GOAL-RUN9 §8 — spec screen 3): product card, goal,
// recommended angles, gear settings, three drafts. Publishing itself stays in
// the composer behind an explicit click (D4).
export default async function StartPage() {
  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const [context, locale] = await Promise.all([getWorkspaceContext(workspace.id), getLocale()]);
  const copy = getProductCopy(locale);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{copy.start_title}</h1>
        <p className="mt-1 text-sm text-gray-500">{copy.start_subtitle}</p>
      </div>
      <PublishTabs active="start" />
      <StartFlow
        locale={locale}
        workspaceName={workspace.name}
        productDescription={context?.product_description ?? null}
      />
    </div>
  );
}
