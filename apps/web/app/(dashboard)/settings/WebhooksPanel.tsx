'use client';

import { useEffect, useState, useTransition } from 'react';
import type { WebhookEvent } from '@prolora/shared';
import { Card } from '@/app/components/Card';
import { Button } from '@/app/components/Button';
import { Input } from '@/app/components/Input';
import { Badge } from '@/app/components/Badge';
import { Modal } from '@/app/components/Modal';
import { EmptyState } from '@/app/components/EmptyState';
import { Spinner } from '@/app/components/Spinner';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { deleteWebhook } from '@/lib/settings/webhooks-admin';

interface WebhookSummary {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  last_triggered_at: string | null;
  failure_count: number;
  created_at: string;
}

const EVENT_OPTIONS: { value: WebhookEvent; label: string }[] = [
  { value: 'post.published', label: 'Post published' },
  { value: 'post.failed', label: 'Post failed' },
  { value: 'feedback.received', label: 'Feedback received' },
  { value: 'feedback.alert', label: 'Feedback alert' },
];

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : 'Never';
}

// Real route (app/api/v1/webhooks/route.ts) — list/create go through
// fetchApi. There is no DELETE route for a single webhook, so delete runs as
// a Server Action (lib/settings/webhooks-admin.ts) instead, same pattern as
// the API-keys tab.
export function WebhooksPanel({ workspaceId }: { workspaceId: string }) {
  const [webhooks, setWebhooks] = useState<WebhookSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookSummary | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchApi<{ webhooks: WebhookSummary[] }>('/v1/webhooks')
      .then((data) => {
        if (!cancelled) setWebhooks(data.webhooks);
      })
      .catch((error: unknown) => {
        if (!cancelled) setToast({ variant: 'error', message: errorMessage(error) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleEvent(value: WebhookEvent) {
    setEvents((prev) => (prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]));
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setUrl('');
    setEvents([]);
    setNewSecret(null);
  }

  function handleCreate() {
    if (!url.trim() || events.length === 0) return;
    startTransition(async () => {
      try {
        const result = await fetchApi<{ webhook: WebhookSummary; secret: string }>('/v1/webhooks', {
          method: 'POST',
          body: JSON.stringify({ url, events }),
        });
        setWebhooks((prev) => [result.webhook, ...(prev ?? [])]);
        setNewSecret(result.secret);
      } catch (error) {
        setToast({ variant: 'error', message: errorMessage(error) });
      }
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      try {
        await deleteWebhook(workspaceId, target.id);
        setWebhooks((prev) => (prev ?? []).filter((webhook) => webhook.id !== target.id));
        setToast({ variant: 'success', message: 'Webhook deleted.' });
      } catch (error) {
        setToast({ variant: 'error', message: errorMessage(error) });
      } finally {
        setDeleteTarget(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card
        title="Webhooks"
        description="Get a signed POST at a URL of your choosing when these events happen."
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Add webhook
          </Button>
        }
        flush={Boolean(webhooks && webhooks.length > 0)}
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner label="Loading webhooks" />
          </div>
        ) : !webhooks || webhooks.length === 0 ? (
          <EmptyState
            title="No webhooks yet"
            description="Add one to receive real-time notifications when posts publish or feedback comes in."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-5 py-2 font-medium">URL</th>
                  <th className="px-5 py-2 font-medium">Events</th>
                  <th className="px-5 py-2 font-medium">Failures</th>
                  <th className="px-5 py-2 font-medium">Last triggered</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {webhooks.map((hook) => (
                  <tr key={hook.id}>
                    <td className="max-w-xs truncate px-5 py-3 font-mono text-gray-900">{hook.url}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {hook.events.map((event) => (
                          <Badge key={event} tone="gray">
                            {event}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {hook.failure_count > 0 ? (
                        <Badge tone="red">{hook.failure_count}</Badge>
                      ) : (
                        <span className="text-gray-500">0</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(hook.last_triggered_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(hook)}>
                        Delete
                      </Button>
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
        title={newSecret ? 'Webhook created' : 'Add webhook'}
        description={newSecret ? undefined : 'Prolora will POST a signed JSON payload to this URL.'}
        footer={
          newSecret ? (
            <Button onClick={closeCreateModal}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeCreateModal}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                loading={pending}
                disabled={!url.trim() || events.length === 0}
              >
                Add
              </Button>
            </>
          )
        }
      >
        {newSecret ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-red-600">
              Copy this signing secret now — you won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-gray-900">
                {newSecret}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigator.clipboard.writeText(newSecret)}
              >
                Copy
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Input
              label="URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/webhooks/prolora"
              type="url"
              autoFocus
            />
            <div>
              <p className="mb-1.5 text-sm font-medium text-gray-900">Events</p>
              <div className="space-y-2">
                {EVENT_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={events.includes(option.value)}
                      onChange={() => toggleEvent(option.value)}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-600"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete webhook"
        description={`Prolora will stop sending events to "${deleteTarget?.url ?? ''}".`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={pending}>
              Delete
            </Button>
          </>
        }
      />

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
