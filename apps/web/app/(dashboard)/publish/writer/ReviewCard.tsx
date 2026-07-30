'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/app/components/Button';
import { Textarea } from '@/app/components/Input';
import { reviewHasApprovalContext, type WriterReview } from './writer-model';
import type { WriterCopy } from './writer-copy';

type ReviewBusyAction = 'approve' | 'edit' | 'alternate' | 'reject' | null;

export function ReviewCard({
  review,
  copy,
  disabled,
  busy = null,
  onApprove,
  onEdit,
  onAlternate,
  onReject,
}: {
  review: WriterReview;
  copy: WriterCopy;
  disabled: boolean;
  busy?: ReviewBusyAction;
  onApprove?: (selectedChannelIds: string[]) => Promise<void>;
  onEdit?: (channelCopy: Record<string, string>) => Promise<void>;
  onAlternate?: () => Promise<void>;
  onReject?: (reason: string, note: string) => Promise<void>;
}) {
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() =>
    review.channels.map((channel) => channel.id)
  );
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(review.channels.map((channel) => [channel.id, channel.content]))
  );
  const [rejectionReason, setRejectionReason] =
    useState<keyof WriterCopy['review']['rejectionReasons']>('off_brand');
  const [rejectionNote, setRejectionNote] = useState('');

  const selectedCount = selectedChannels.length;
  const hasRequiredContext = reviewHasApprovalContext(review, selectedChannels);
  const selectedChannelsPassGate =
    selectedCount > 0 &&
    review.channels
      .filter((channel) => selectedChannels.includes(channel.id))
      .every((channel) => channel.gatePassed);
  const hasDraftChanges = review.channels.some(
    (channel) => (drafts[channel.id] ?? '') !== channel.content
  );
  const visibleChannels = useMemo(
    () => review.channels.filter((channel) => selectedChannels.includes(channel.id)),
    [review.channels, selectedChannels]
  );

  function toggleChannel(channelId: string) {
    setSelectedChannels((current) =>
      current.includes(channelId)
        ? current.filter((id) => id !== channelId)
        : [...current, channelId]
    );
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onEdit || !hasDraftChanges) return;
    await onEdit(drafts);
    setEditing(false);
  }

  async function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onReject) return;
    await onReject(rejectionReason, rejectionNote.trim());
    setRejecting(false);
    setRejectionNote('');
  }

  return (
    <article className="overflow-hidden rounded-3xl border border-gray-200/80 bg-white shadow-[0_28px_90px_-48px_rgba(15,23,42,0.48)]">
      <header className="relative overflow-hidden border-b border-gray-100 px-5 py-6 sm:px-8 sm:py-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary-100/60 blur-3xl"
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-gray-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                {copy.review.recommended}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                  selectedChannelsPassGate
                    ? 'bg-green-50 text-green-700 ring-green-600/15'
                    : 'bg-amber-50 text-amber-800 ring-amber-600/15'
                }`}
              >
                <span aria-hidden="true" className="mr-1">
                  {selectedChannelsPassGate ? '✓' : '!'}
                </span>
                {selectedChannelsPassGate ? copy.review.gatePassed : copy.review.gateBlocked}
              </span>
            </div>
            <h2 className="mt-4 text-balance text-2xl font-semibold tracking-[-0.025em] text-gray-950 sm:text-3xl">
              {review.title}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600">{review.preview}</p>
          </div>

          <div className="min-w-[15rem] rounded-2xl border border-gray-200 bg-white/85 p-4 shadow-sm backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
              {copy.review.schedule}
            </p>
            <p className="mt-2 text-base font-semibold text-gray-950">{review.proposedLocalTime}</p>
            <p className="mt-0.5 text-sm text-gray-500">{review.timezone}</p>
            <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
              <span className="font-medium text-gray-700">{copy.review.utcTime}</span>{' '}
              <time dateTime={review.proposedUtcTime}>{review.proposedUtcTime}</time>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.7fr)]">
        <div className="border-gray-100 px-5 py-6 sm:px-8 xl:border-r">
          <section aria-labelledby={`writer-channels-${review.id}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 id={`writer-channels-${review.id}`} className="text-sm font-semibold text-gray-950">
                  {copy.review.channels}
                </h3>
                <p className="mt-1 text-xs text-gray-500">
                  {selectedCount}/{review.channels.length} {copy.review.selectedChannels}
                </p>
              </div>
              <div className="flex flex-wrap gap-2" aria-label={copy.review.selectedChannels}>
                {review.channels.map((channel) => (
                  <label
                    key={channel.id}
                    className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors motion-reduce:transition-none ${
                      selectedChannels.includes(channel.id)
                        ? 'border-primary-300 bg-primary-50 text-primary-800'
                        : 'border-gray-200 bg-white text-gray-500'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannels.includes(channel.id)}
                      disabled={disabled}
                      onChange={() => toggleChannel(channel.id)}
                      className="size-4 accent-primary-600"
                    />
                    {channel.platform} · {channel.accountName}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {visibleChannels.map((channel) => (
                <section
                  key={channel.id}
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60"
                  aria-labelledby={`writer-channel-${channel.id}`}
                >
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
                    <div>
                      <h4
                        id={`writer-channel-${channel.id}`}
                        className="text-sm font-semibold capitalize text-gray-950"
                      >
                        {channel.platform}
                      </h4>
                      <p className="text-xs text-gray-500">{channel.accountName}</p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-600">
                      {channel.format}
                    </span>
                  </header>

                  <div className="p-4 sm:p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                      {copy.review.exactPreview}
                    </p>
                    {editing ? (
                      <Textarea
                        name={`writer-copy-${channel.id}`}
                        aria-label={`${copy.actions.edit}: ${channel.platform}`}
                        rows={10}
                        value={drafts[channel.id] ?? ''}
                        disabled={busy === 'edit'}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [channel.id]: event.target.value,
                          }))
                        }
                        className="mt-3"
                      />
                    ) : channel.segments.length > 0 ? (
                      <ol className="mt-3 space-y-3">
                        {channel.segments.map((segment, index) => (
                          <li
                            key={`${channel.id}-${index}`}
                            className="rounded-xl bg-white p-4 text-sm leading-6 whitespace-pre-wrap text-gray-800 ring-1 ring-gray-200"
                          >
                            <span className="mb-2 block text-xs font-semibold text-gray-400">
                              {copy.review.threadPart} {index + 1}/{channel.segments.length}
                            </span>
                            {segment}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-3 text-[15px] leading-7 whitespace-pre-wrap text-gray-800">
                        {channel.content}
                      </p>
                    )}

                    {(channel.media.length > 0 || channel.firstComment) && (
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {channel.media.map((media) => (
                          <div
                            key={`${channel.id}-${media.label}`}
                            className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm"
                          >
                            <p className="font-medium text-gray-800">
                              {copy.review.media}: {media.label}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">
                              {copy.review.altText}: {media.altText || '—'}
                            </p>
                          </div>
                        ))}
                        {channel.firstComment && (
                          <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm">
                            <p className="font-medium text-gray-800">{copy.review.firstComment}</p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">
                              {channel.firstComment}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </section>

          {editing && (
            <form onSubmit={(event) => void submitEdit(event)} className="mt-5 flex flex-wrap gap-2">
              <Button
                type="submit"
                loading={busy === 'edit'}
                disabled={disabled || !hasDraftChanges}
              >
                {copy.actions.saveEdit}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {copy.actions.cancel}
              </Button>
            </form>
          )}
        </div>

        <aside className="space-y-6 bg-gray-50/45 px-5 py-6 sm:px-7">
          <ContextBlock title={copy.review.whyNow}>
            <p>{review.whyNow || '—'}</p>
          </ContextBlock>

          <ContextBlock title={copy.review.sources}>
            <ul className="space-y-3">
              {review.claims.map((claim) => (
                <li key={`${claim.text}-${claim.sourceLabel}`} className="rounded-xl bg-white p-3 ring-1 ring-gray-200">
                  <p className="text-sm font-medium leading-5 text-gray-800">{claim.text}</p>
                  <p className="mt-1.5 text-xs leading-5 text-gray-500">
                    {claim.sourceUrl ? (
                      <a
                        href={claim.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm underline decoration-gray-300 underline-offset-2 hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                      >
                        {claim.sourceLabel}
                      </a>
                    ) : (
                      claim.sourceLabel
                    )}{' '}
                    ·{' '}
                    <span className={claim.verified ? 'text-green-700' : 'text-amber-700'}>
                      {claim.verified ? copy.review.verified : copy.review.unverified}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </ContextBlock>

          <ContextBlock title={copy.review.gate}>
            <p
              className={`flex gap-2 ${
                selectedChannelsPassGate ? 'text-green-700' : 'text-amber-800'
              }`}
            >
              <span aria-hidden="true">{selectedChannelsPassGate ? '✓' : '!'}</span>
              <span>
                {selectedChannelsPassGate ? copy.review.gatePassed : copy.review.gateBlocked}
              </span>
            </p>
            <ReviewSignals label={copy.review.warnings} values={review.warnings} />
            <ReviewSignals label={copy.review.skipped} values={review.skippedChecks} />
            <ReviewSignals label={copy.review.overrides} values={review.overrides} />
          </ContextBlock>

          {review.changes.length > 0 && (
            <ContextBlock title={copy.review.changes}>
              <ul className="list-disc space-y-1 pl-4">
                {review.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </ContextBlock>
          )}

          <div className="rounded-xl border border-dashed border-gray-300 px-3 py-3 text-xs leading-5 text-gray-500">
            <p className="font-semibold text-gray-700">{copy.review.snapshot}</p>
            <p className="mt-1 font-mono">{review.snapshotHash.slice(0, 12)}…</p>
          </div>
        </aside>
      </div>

      <footer className="border-t border-gray-100 bg-white px-5 py-5 sm:px-8">
        <div className="flex flex-col-reverse gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              data-emphasis="secondary"
              disabled={disabled || busy !== null}
              onClick={() => {
                setEditing(true);
                setRejecting(false);
              }}
              className="min-h-11"
            >
              {copy.actions.edit}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-emphasis="secondary"
              loading={busy === 'alternate'}
              disabled={disabled || busy !== null}
              onClick={() => void onAlternate?.()}
              className="min-h-11"
            >
              {copy.actions.alternate}
            </Button>
            <Button
              type="button"
              variant="ghost"
              data-emphasis="secondary"
              disabled={disabled || busy !== null}
              onClick={() => {
                setRejecting(true);
                setEditing(false);
              }}
              className="min-h-11 text-red-700 hover:bg-red-50"
            >
              {copy.actions.reject}
            </Button>
          </div>

          <div className="max-w-xl">
            <Button
              type="button"
              size="lg"
              data-emphasis="primary"
              loading={busy === 'approve'}
              disabled={
                disabled || busy !== null || selectedCount === 0 || !hasRequiredContext
              }
              onClick={() => void onApprove?.(selectedChannels)}
              className="min-h-12 w-full rounded-xl px-6 shadow-[0_12px_30px_-14px_rgba(37,99,235,0.9)] sm:w-auto"
            >
              {busy === 'approve' ? copy.actions.approving : copy.actions.approve}
            </Button>
            <p className="mt-2 text-xs leading-5 text-gray-500">{copy.review.approvalHint}</p>
          </div>
        </div>

        {rejecting && (
          <form
            onSubmit={(event) => void submitRejection(event)}
            className="mt-5 rounded-2xl border border-red-100 bg-red-50/60 p-4"
          >
            <h3 className="text-sm font-semibold text-red-950">{copy.review.rejectTitle}</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-900">
                {copy.review.rejectReason}
                <select
                  value={rejectionReason}
                  onChange={(event) =>
                    setRejectionReason(
                      event.target.value as keyof WriterCopy['review']['rejectionReasons']
                    )
                  }
                  className="mt-1.5 block min-h-11 w-full rounded-md border-0 bg-white px-3 text-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-red-500"
                >
                  {Object.entries(copy.review.rejectionReasons).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Textarea
                name={`writer-rejection-note-${review.id}`}
                label={copy.review.rejectDetails}
                rows={3}
                maxLength={1000}
                value={rejectionNote}
                onChange={(event) => setRejectionNote(event.target.value)}
              />
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="submit" variant="danger" loading={busy === 'reject'}>
                {copy.actions.reject}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
                {copy.actions.cancel}
              </Button>
            </div>
          </form>
        )}
      </footer>
    </article>
  );
}

function ContextBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">{title}</h3>
      <div className="mt-2 text-sm leading-6 text-gray-700">{children}</div>
    </section>
  );
}

function ReviewSignals({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <ul className="mt-1 space-y-1 text-xs text-amber-800">
        {values.map((value) => (
          <li key={value}>• {value}</li>
        ))}
      </ul>
    </div>
  );
}
