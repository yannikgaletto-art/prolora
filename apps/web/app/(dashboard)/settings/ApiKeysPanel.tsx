'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/app/components/Card';
import { Button } from '@/app/components/Button';
import { Input } from '@/app/components/Input';
import { Badge } from '@/app/components/Badge';
import { Modal } from '@/app/components/Modal';
import { EmptyState } from '@/app/components/EmptyState';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { createApiKey, revokeApiKey, type ApiKeySummary } from '@/lib/settings/api-keys';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : '—';
}

export function ApiKeysPanel({
  workspaceId,
  initialKeys,
}: {
  workspaceId: string;
  initialKeys: ApiKeySummary[];
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, startTransition] = useTransition();

  function closeCreateModal() {
    setCreateOpen(false);
    setName('');
    setRawKey(null);
  }

  function handleCreate() {
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        const result = await createApiKey(workspaceId, name);
        setKeys((prev) => [result.apiKey, ...prev]);
        setRawKey(result.key);
      } catch (error) {
        setToast({
          variant: 'error',
          message: error instanceof Error ? error.message : 'Could not create key.',
        });
      }
    });
  }

  function handleRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    startTransition(async () => {
      try {
        await revokeApiKey(workspaceId, target.id);
        setKeys((prev) =>
          prev.map((key) =>
            key.id === target.id ? { ...key, revoked_at: new Date().toISOString() } : key
          )
        );
        setToast({ variant: 'success', message: `"${target.name ?? target.key_prefix}" revoked.` });
      } catch (error) {
        setToast({
          variant: 'error',
          message: error instanceof Error ? error.message : 'Could not revoke key.',
        });
      } finally {
        setRevokeTarget(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card
        title="API keys"
        description="Use these to authenticate requests to the Prolora API (x-prolora-key header)."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create key
          </Button>
        }
        flush={keys.length > 0}
      >
        {keys.length === 0 ? (
          <EmptyState
            title="No API keys yet"
            description="Create one to start calling the Prolora API."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Name</th>
                  <th className="px-5 py-2 font-medium">Key</th>
                  <th className="px-5 py-2 font-medium">Created</th>
                  <th className="px-5 py-2 font-medium">Last used</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td className="px-5 py-3 text-gray-900">{key.name ?? '—'}</td>
                    <td className="px-5 py-3 font-mono text-gray-500">{key.key_prefix}…</td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(key.created_at)}</td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(key.last_used_at)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={key.revoked_at ? 'red' : 'green'}>
                        {key.revoked_at ? 'Revoked' : 'Active'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!key.revoked_at && (
                        <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(key)}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={rawKey ? 'Key created' : 'Create API key'}
        description={rawKey ? undefined : 'Give it a name so you remember what it is for.'}
        footer={
          rawKey ? (
            <Button onClick={closeCreateModal}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeCreateModal}>
                Cancel
              </Button>
              <Button onClick={handleCreate} loading={pending} disabled={!name.trim()}>
                Create
              </Button>
            </>
          )
        }
      >
        {rawKey ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-red-600">
              Copy this key now — you won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-gray-900">
                {rawKey}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigator.clipboard.writeText(rawKey)}
              >
                Copy
              </Button>
            </div>
          </div>
        ) : (
          <Input
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Zapier integration"
            maxLength={100}
            autoFocus
          />
        )}
      </Modal>

      <Modal
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        title="Revoke API key"
        description={`Requests using "${
          revokeTarget?.name ?? revokeTarget?.key_prefix ?? ''
        }" will stop working immediately. This cannot be undone.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleRevoke} loading={pending}>
              Revoke
            </Button>
          </>
        }
      />

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
