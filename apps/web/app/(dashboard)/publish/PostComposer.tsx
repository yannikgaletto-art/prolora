'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { FormEvent } from 'react';
import type { CreatePostRequest, CreatePostResponse } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Textarea } from '@/app/components/Input';
import { EmptyState } from '@/app/components/EmptyState';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { ConnectionWithLimit } from '@/lib/connections/list-connections';
import { PLATFORM_META } from './platform-meta';
import { TemplatePicker, type AppliedTemplate } from './TemplatePicker';

const MAX_SCHEDULE_DAYS = 60;

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function PostComposer({ connections }: { connections: ConnectionWithLimit[] }) {
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adaptContent, setAdaptContent] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [showFirstComment, setShowFirstComment] = useState(false);
  const [firstComment, setFirstComment] = useState('');
  const [templateExtras, setTemplateExtras] = useState<AppliedTemplate['extras']>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const hasConnections = connections.length > 0;

  const tightestLimit = useMemo(() => {
    const selectedConnections = connections.filter((c) => selected.has(c.connection_id));
    const pool = selectedConnections.length > 0 ? selectedConnections : connections;
    if (pool.length === 0) return undefined;
    return Math.min(...pool.map((c) => c.character_limit));
  }, [connections, selected]);

  const overLimit = tightestLimit !== undefined && content.length > tightestLimit;

  const minSchedule = useMemo(() => toLocalInputValue(new Date()), []);
  const maxSchedule = useMemo(
    () => toLocalInputValue(new Date(Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000)),
    []
  );

  function toggleConnection(connectionId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(connectionId)) next.delete(connectionId);
      else next.add(connectionId);
      return next;
    });
  }

  function resetForm() {
    setContent('');
    setSelected(new Set());
    setAdaptContent(false);
    setScheduleMode('now');
    setScheduledAt('');
    setShowFirstComment(false);
    setFirstComment('');
    setTemplateExtras(null);
  }

  // A template draft lands as normal, editable composer state — the existing
  // create-post flow stays untouched (GOAL-RUN4 T2-3).
  function applyTemplate(result: AppliedTemplate) {
    setContent(result.content);
    if (result.firstComment) {
      setShowFirstComment(true);
      setFirstComment(result.firstComment);
    }
    if (result.connectionIds.length > 0) {
      setSelected(new Set(result.connectionIds));
    }
    setAdaptContent(true);
    setTemplateExtras(result.extras);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!content.trim()) {
      setFormError('Write something before publishing.');
      return;
    }
    if (selected.size === 0) {
      setFormError('Select at least one connected account.');
      return;
    }

    let scheduledAtIso: string | undefined;
    if (scheduleMode === 'schedule') {
      if (!scheduledAt) {
        setFormError('Choose a date and time to schedule for.');
        return;
      }
      const scheduledDate = new Date(scheduledAt);
      if (Number.isNaN(scheduledDate.getTime())) {
        setFormError('That schedule date is not valid.');
        return;
      }
      if (scheduledDate.getTime() < Date.now() - 60_000) {
        setFormError('Scheduled time is in the past.');
        return;
      }
      if (scheduledDate.getTime() > Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
        setFormError(`Scheduled time can be at most ${MAX_SCHEDULE_DAYS} days out.`);
        return;
      }
      scheduledAtIso = scheduledDate.toISOString();
    }

    const payload: CreatePostRequest = {
      content,
      platforms: [...selected],
      adapt_content: adaptContent || undefined,
      scheduled_at: scheduledAtIso,
      first_comment: showFirstComment && firstComment.trim() ? firstComment.trim() : undefined,
    };

    setSubmitting(true);
    try {
      const response = await fetchApi<CreatePostResponse>('/v1/posts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setToast({
        variant: 'success',
        message:
          response.items.length === 1
            ? 'Post queued for 1 platform.'
            : `Post queued for ${response.items.length} platforms.`,
        action: (
          <Link href="/publish/posts" className="underline">
            View posts
          </Link>
        ),
      });
      resetForm();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <Card
          title="Content"
          description="Write once — Prolora sends it to every account you pick below."
          actions={<TemplatePicker connections={connections} onApply={applyTemplate} />}
        >
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label="Post content"
              rows={6}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="What do you want to share?"
            />
            <div className="flex items-center justify-between text-xs">
              <span className={overLimit ? 'font-medium text-red-600' : 'text-gray-500'}>
                {content.length}
                {tightestLimit !== undefined ? ` / ${tightestLimit}` : ''} characters
              </span>
              {overLimit && (
                <span className="font-medium text-red-600">
                  Over the tightest connected platform&apos;s limit
                </span>
              )}
            </div>
          </div>
        </Card>

        {templateExtras && (
          <Card
            title={`Template extras — ${templateExtras.templateName}`}
            description="Prolora can't publish these parts automatically yet — copy what you need."
            actions={
              <button
                type="button"
                onClick={() => setTemplateExtras(null)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Dismiss
              </button>
            }
          >
            <div className="flex flex-col gap-3">
              {templateExtras.slides && templateExtras.slides.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Slides
                  </p>
                  <ol className="flex flex-col gap-1.5">
                    {templateExtras.slides.map((slide, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-900">
                        <span className="mt-0.5 shrink-0 text-xs font-semibold text-gray-400">
                          {index + 1}.
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap">{slide}</span>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(slide)}
                          className="shrink-0 text-xs font-medium text-primary-700 hover:text-primary-800"
                        >
                          Copy
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {templateExtras.manualSteps && templateExtras.manualSteps.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Manual steps
                  </p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-gray-700">
                    {templateExtras.manualSteps.map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}

        <Card
          title="Platforms"
          description="Choose which connected accounts receive this post."
        >
          {hasConnections ? (
            <div className="flex flex-col gap-2">
              {connections.map((connection) => {
                const meta = PLATFORM_META[connection.platform];
                const checked = selected.has(connection.connection_id);
                const disabled = connection.status !== 'active';
                return (
                  <label
                    key={connection.connection_id}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${
                      disabled
                        ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60'
                        : checked
                          ? 'cursor-pointer border-primary-300 bg-primary-50'
                          : 'cursor-pointer border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleConnection(connection.connection_id)}
                      className="h-4 w-4 rounded text-primary-600"
                    />
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: meta.color }}
                    >
                      {meta.initial}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {connection.account_name}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {meta.label}
                        {disabled ? ` — ${connection.status}` : ` — limit ${connection.character_limit}`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No connected accounts yet"
              description="Connect a platform to start publishing from Prolora."
              action={
                <Link
                  href="/connections"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  Go to Connections
                </Link>
              }
            />
          )}
        </Card>

        <Card title="Adaptation">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={adaptContent}
              onChange={(event) => setAdaptContent(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded text-primary-600"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Adapt content per platform</span>
              <span className="block text-xs text-gray-500">
                Let AI reword the post for each platform&apos;s tone and length — still respects each
                limit.
              </span>
            </span>
          </label>
        </Card>

        <Card title="Schedule">
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input
                  type="radio"
                  name="schedule-mode"
                  checked={scheduleMode === 'now'}
                  onChange={() => setScheduleMode('now')}
                  className="h-4 w-4 text-primary-600"
                />
                Now
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input
                  type="radio"
                  name="schedule-mode"
                  checked={scheduleMode === 'schedule'}
                  onChange={() => setScheduleMode('schedule')}
                  className="h-4 w-4 text-primary-600"
                />
                Schedule for later
              </label>
            </div>
            {scheduleMode === 'schedule' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                min={minSchedule}
                max={maxSchedule}
                onChange={(event) => setScheduledAt(event.target.value)}
                className="block w-full max-w-xs rounded-md border-0 px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-primary-600"
              />
            )}
          </div>
        </Card>

        <Card title="First comment (optional)">
          {showFirstComment ? (
            <div className="flex flex-col gap-2">
              <Textarea
                aria-label="First comment"
                rows={3}
                value={firstComment}
                onChange={(event) => setFirstComment(event.target.value)}
                placeholder="Add a first comment (e.g. links, credits)…"
              />
              <button
                type="button"
                onClick={() => {
                  setShowFirstComment(false);
                  setFirstComment('');
                }}
                className="self-start text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Remove first comment
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowFirstComment(true)}
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              + Add a first comment
            </button>
          )}
        </Card>

        <div className="flex items-center justify-end gap-3">
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <Button type="submit" loading={submitting} disabled={!hasConnections}>
            {scheduleMode === 'schedule' ? 'Schedule post' : 'Publish now'}
          </Button>
        </div>
      </form>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </>
  );
}
