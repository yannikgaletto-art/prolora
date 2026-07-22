import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveWorkspace } from '@/lib/workspace/active';
import { getResponseMapEntries } from '@/lib/discovery/list-response-map';
import { Card } from '@/app/components/Card';
import { Badge } from '@/app/components/Badge';
import { EmptyState } from '@/app/components/EmptyState';

export const metadata: Metadata = { title: 'Response Map — Prolora' };

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

const LINK_POLICY_LABEL: Record<string, string> = {
  never: 'Never link',
  if_asked: 'Link if asked',
  in_followup: 'Link in follow-up',
};

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Server Component (F0-4, Pfad A): reads response_map through the service
// layer directly — never by fetch()-ing our own /api/v1 route. This
// directory has no F-phase in the spec, but the backing GET route is
// trivial and fully supported, so this is a real listing, not a fake
// EmptyState.
export default async function ResponseMapPage() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.getUser(); // session already validated by the dashboard layout
  const workspace = await getActiveWorkspace(supabase);
  if (!workspace) redirect('/onboarding');

  const entries = await getResponseMapEntries(workspace.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Response Map</h1>
        <p className="mt-1 text-sm text-gray-500">
          Proven answers, ranked by how well they perform when reused.
        </p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No proven answers yet"
          description="As replies get posted and tracked, the ones with the best engagement will show up here for reuse in future drafts."
        />
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{entry.question_pattern}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {entry.intent_type && <Badge tone="teal">{humanize(entry.intent_type)}</Badge>}
                  <Badge tone="gray">{LINK_POLICY_LABEL[entry.link_policy] ?? entry.link_policy}</Badge>
                </div>
              </div>

              <p className="mt-3 text-sm text-gray-600">{entry.best_answer}</p>

              <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-100 pt-3 text-sm text-gray-500">
                <span>
                  Used {entry.times_used} {entry.times_used === 1 ? 'time' : 'times'}
                </span>
                <span>Avg engagement: {numberFormatter.format(entry.avg_engagement)}</span>
                {entry.proof_asset_url && (
                  <a
                    href={entry.proof_asset_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-700 hover:text-primary-800"
                  >
                    Proof asset
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
