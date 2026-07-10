'use client';

import { useActionState } from 'react';
import { Input } from '@/app/components/Input';
import { Button } from '@/app/components/Button';
import { renameWorkspaceAction, type RenameState } from './actions';

const INITIAL_STATE: RenameState = { status: 'idle' };

export function WorkspaceNameForm({ initialName }: { initialName: string }) {
  const [state, formAction, pending] = useActionState(renameWorkspaceAction, INITIAL_STATE);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <Input label="Workspace name" name="name" defaultValue={initialName} maxLength={100} required />
      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending} size="md">
          Save
        </Button>
        {state.status === 'success' && (
          <span className="text-sm text-green-700">{state.message}</span>
        )}
        {state.status === 'error' && <span className="text-sm text-red-600">{state.message}</span>}
      </div>
    </form>
  );
}
