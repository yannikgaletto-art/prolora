import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { listPublicChangelog } from '@/lib/changelog/changelog-service';
import { Card } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';

export const metadata: Metadata = { title: 'Changelog — Prolora' };

const PER_PAGE = 20;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
});

// Server Component: no dedicated F-phase yet, so this stays minimal — a
// read-only list of published entries via the existing public list function.
// Authoring/AI-drafting UI is out of scope until a phase claims it.
export default async function ChangelogPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const { entries } = workspace.slug
    ? await listPublicChangelog(workspace.slug, 1, PER_PAGE)
    : { entries: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Changelog</h1>
        <p className="mt-1 text-sm text-gray-500">Published updates visible on your public board.</p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No published changelog entries yet"
          description="Published entries will appear here in order of release date."
        />
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <Card key={entry.id} title={entry.title} description={dateFormatter.format(new Date(entry.published_at))}>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{entry.content}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
