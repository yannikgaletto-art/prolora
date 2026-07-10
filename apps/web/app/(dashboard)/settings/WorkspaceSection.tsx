import { Card } from '@/app/components/Card';
import { WorkspaceNameForm } from './WorkspaceNameForm';

// Server Component: the rename form is the only interactive leaf ('use
// client', for useActionState) — everything else here renders statically.
export function WorkspaceSection({ name, slug }: { name: string; slug: string | null }) {
  return (
    <div className="space-y-4">
      <Card title="Workspace name" description="Shown across Prolora and in exports.">
        <WorkspaceNameForm initialName={name} />
      </Card>

      <Card title="Workspace URL">
        <p className="font-mono text-sm text-gray-900">{slug ?? '—'}</p>
        {/* Slug editing has no backend support yet (would need uniqueness
            re-validation + link updates elsewhere) — showing it read-only
            beats a form that silently does nothing. */}
        <p className="mt-2 text-sm text-gray-500">
          This is assigned automatically and can&apos;t be changed yet.
        </p>
      </Card>
    </div>
  );
}
