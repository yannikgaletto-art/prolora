import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listWorkspaces } from '@/lib/workspace/workspace-lifecycle';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { getConnections } from '@/lib/connections/list-connections';
import { getLocale } from '@/lib/i18n/server';
import { getProductCopy } from '@/lib/i18n/product';
import { Card } from '@/app/components/Card';
import { addProduct, switchProduct } from './actions';

export const metadata: Metadata = { title: 'Products — Prolora' };

// Product library (GOAL-RUN9 §9 — spec screen 1). D1: one workspace = one
// product, so this page is the workspace switcher wearing product clothes.
// Workspace ids all come from the RLS-scoped session query.
export default async function ProductsPage() {
  const supabase = await createSupabaseServerClient();
  const [workspaces, active, locale] = await Promise.all([
    listWorkspaces(supabase),
    getActiveWorkspace(supabase),
    getLocale(),
  ]);
  if (!active) redirect('/onboarding');
  const copy = getProductCopy(locale);

  const details = await Promise.all(
    workspaces.map(async (workspace) => {
      const [context, connections] = await Promise.all([
        getWorkspaceContext(workspace.id),
        getConnections(workspace.id),
      ]);
      return {
        workspace,
        description: context?.product_description ?? null,
        platforms: [...new Set(connections.map((connection) => connection.platform))],
      };
    })
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-gray-900">{copy.library_title}</h1>
        <p className="mt-1 text-sm text-gray-500">{copy.library_subtitle}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {details.map(({ workspace, description, platforms }) => {
          const isActive = workspace.id === active.id;
          return (
            <div
              key={workspace.id}
              className={`flex flex-col gap-2 rounded-lg border p-4 ${
                isActive ? 'border-primary-600 bg-primary-50/40' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">{workspace.name}</span>
                {isActive && (
                  <span className="rounded-full bg-primary-600 px-2 py-0.5 text-xs font-medium text-white">
                    {copy.library_active}
                  </span>
                )}
              </div>
              <p className="line-clamp-2 min-h-10 text-sm text-gray-600">
                {description ?? copy.start_no_profile}
              </p>
              <p className="text-xs text-gray-500">
                {platforms.length > 0 ? platforms.join(' · ') : copy.library_platforms_none}
              </p>
              <div className="mt-2 flex gap-2">
                <form action={switchProduct.bind(null, workspace.id)}>
                  <button
                    type="submit"
                    className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
                  >
                    {copy.library_post_cta}
                  </button>
                </form>
                {isActive && (
                  <a
                    href="/product"
                    className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-300"
                  >
                    {copy.library_edit_cta}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <Card title={copy.library_add}>
          <form action={addProduct} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={60}
              placeholder={copy.library_add_placeholder}
              className="w-64 rounded-md border border-gray-200 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
            >
              {copy.library_add}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
