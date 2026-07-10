import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getAllBoardItemsForWorkspace } from '@/lib/board/board-service';
import { Card } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';
import { BoardTable } from './BoardTable';

export const metadata: Metadata = { title: 'Board — Prolora' };

// Server Component (F5-1): reads through the service layer directly, never
// via fetch() against our own API routes.
export default async function BoardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const items = await getAllBoardItemsForWorkspace(workspace.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Feedback board</h1>
          <p className="mt-1 text-sm text-gray-500">
            Ideas and requests submitted by your customers, with vote counts and status.
          </p>
        </div>
        {workspace.slug && (
          <a
            href={`/board/${workspace.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-primary-700 ring-1 ring-inset ring-primary-200 hover:bg-primary-50"
          >
            View public board
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No board items yet"
          description="Once customers submit ideas on your public board, they'll show up here."
        />
      ) : !workspace.slug ? (
        <EmptyState
          title="Workspace has no public slug"
          description="A slug is required to manage board item statuses and to publish a public board."
        />
      ) : (
        <Card flush>
          <BoardTable items={items} workspaceSlug={workspace.slug} />
        </Card>
      )}
    </div>
  );
}
