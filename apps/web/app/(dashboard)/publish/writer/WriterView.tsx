'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/app/components/Button';
import { errorMessage, fetchApi } from '@/app/lib/api';
import { ContentDnaPanel, type AddWriterSampleInput } from './ContentDnaPanel';
import { ReviewCard } from './ReviewCard';
import { createWriterDemoData } from './writer-demo';
import {
  nextWriterSection,
  type WriterHistoryEntry,
  type WriterSection,
  type WriterUiData,
} from './writer-model';
import type { WriterCopy } from './writer-copy';

const WRITER_SECTIONS: readonly WriterSection[] = ['today', 'dna', 'history'];
type BusyAction =
  | 'policy'
  | 'run'
  | 'approve'
  | 'edit'
  | 'alternate'
  | 'reject'
  | 'sample'
  | 'rebuild'
  | null;

interface Notice {
  tone: 'success' | 'error';
  message: string;
}

export function WriterView({
  copy,
  initialData,
}: {
  copy: WriterCopy;
  initialData: WriterUiData;
}) {
  const router = useRouter();
  const [section, setSection] = useState<WriterSection>('today');
  const [data, setData] = useState(initialData);
  const [demoMode, setDemoMode] = useState(false);
  const [enabled, setEnabled] = useState(initialData.policy.enabled);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const tabRefs = useRef<Record<WriterSection, HTMLButtonElement | null>>({
    today: null,
    dna: null,
    history: null,
  });

  const blocked = data.availability === 'migration_pending' || data.availability === 'unavailable';
  const configured = data.availability === 'ready';
  const policyBusy = busy === 'policy';

  function showSuccess(message: string) {
    setNotice({ tone: 'success', message });
    router.refresh();
  }

  function showError(error: unknown) {
    setNotice({ tone: 'error', message: errorMessage(error) });
  }

  async function updatePolicy() {
    const nextEnabled = !enabled;
    if (demoMode) {
      setEnabled(nextEnabled);
      setData((current) => ({ ...current, policy: { ...current.policy, enabled: nextEnabled } }));
      showSuccess(copy.feedback.policyUpdated);
      return;
    }
    setBusy('policy');
    setNotice(null);
    try {
      await fetchApi('/v1/writer/policy', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      setEnabled(nextEnabled);
      showSuccess(copy.feedback.policyUpdated);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function runShadow() {
    if (demoMode) {
      setData((current) => ({ ...current, pendingReview: createWriterDemoData(current.workspaceName).pendingReview, stats: { ...current.stats, awaitingApproval: 1 } }));
      showSuccess(copy.feedback.runStarted);
      return;
    }
    setBusy('run');
    setNotice(null);
    try {
      await fetchApi('/v1/writer/run', {
        method: 'POST',
        body: JSON.stringify({ mode: 'shadow', limit: 1 }),
      });
      showSuccess(copy.feedback.runStarted);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function approve(selectedChannelIds: string[]) {
    const review = data.pendingReview;
    if (!review) return;
    if (demoMode) {
      setData((current) => ({
        ...current,
        pendingReview: null,
        stats: { ...current.stats, awaitingApproval: 0 },
        history: [{ id: `${review.id}-approved`, title: review.title, status: 'approved', occurredAt: new Date().toISOString(), detail: 'Testfreigabe — es wurde nichts eingeplant oder veröffentlicht.' }, ...current.history],
      }));
      showSuccess(copy.feedback.approved);
      return;
    }
    setBusy('approve');
    setNotice(null);
    try {
      await fetchApi(`/v1/writer/reviews/${review.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          snapshot_hash: review.snapshotHash,
          selected_channel_ids: selectedChannelIds,
        }),
      });
      showSuccess(copy.feedback.approved);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function edit(channelCopy: Record<string, string>) {
    const review = data.pendingReview;
    if (!review) return;
    const requestedChannelCopy = Object.fromEntries(
      review.channels
        .filter(
          (channel) => (channelCopy[channel.id] ?? channel.content) !== channel.content
        )
        .map((channel) => [channel.id, channelCopy[channel.id] ?? channel.content])
    );
    if (Object.keys(requestedChannelCopy).length === 0) return;
    if (demoMode) {
      setData((current) => current.pendingReview ? ({ ...current, pendingReview: { ...current.pendingReview, channels: current.pendingReview.channels.map((channel) => ({ ...channel, content: requestedChannelCopy[channel.id] ?? channel.content })) } }) : current);
      showSuccess(copy.feedback.edited);
      return;
    }
    setBusy('edit');
    setNotice(null);
    try {
      await fetchApi(`/v1/writer/reviews/${review.id}/request-change`, {
        method: 'POST',
        body: JSON.stringify({
          snapshot_hash: review.snapshotHash,
          reason: JSON.stringify({
            type: 'channel_copy_edit',
            requested_channel_copy: requestedChannelCopy,
          }),
        }),
      });
      showSuccess(copy.feedback.edited);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function alternate() {
    const review = data.pendingReview;
    if (!review) return;
    if (demoMode) {
      setData((current) => current.pendingReview ? ({ ...current, pendingReview: { ...current.pendingReview, title: 'Alternative Richtung: Weniger erklären, klarer führen', preview: 'Eine alternative Testempfehlung — ebenfalls nur lokal sichtbar.' } }) : current);
      showSuccess(copy.feedback.alternateStarted);
      return;
    }
    setBusy('alternate');
    setNotice(null);
    try {
      await fetchApi(`/v1/writer/reviews/${review.id}/request-change`, {
        method: 'POST',
        body: JSON.stringify({
          snapshot_hash: review.snapshotHash,
          reason: JSON.stringify({ type: 'alternate_direction' }),
        }),
      });
      showSuccess(copy.feedback.alternateStarted);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function reject(reason: string, note: string) {
    const review = data.pendingReview;
    if (!review) return;
    if (demoMode) {
      setData((current) => ({ ...current, pendingReview: null, stats: { ...current.stats, awaitingApproval: 0 }, history: [{ id: `${review.id}-rejected`, title: review.title, status: 'rejected', occurredAt: new Date().toISOString(), detail: note || reason }, ...current.history] }));
      showSuccess(copy.feedback.rejected);
      return;
    }
    setBusy('reject');
    setNotice(null);
    try {
      await fetchApi(`/v1/writer/reviews/${review.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          snapshot_hash: review.snapshotHash,
          reason,
          note: note || undefined,
        }),
      });
      showSuccess(copy.feedback.rejected);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function addSample(input: AddWriterSampleInput) {
    if (demoMode) {
      setData((current) => {
        const sample = { id: `demo-sample-${Date.now()}`, kind: input.kind, origin: input.origin, label: input.label || 'Neues Testsample', platform: null, active: true } as const;
        const samples = [...current.dna.samples, sample];
        const goldenSampleCount = samples.filter((entry) => entry.kind === 'golden').length;
        return { ...current, dna: { ...current.dna, samples, sampleCount: samples.length, goldenSampleCount, avoidSampleCount: samples.length - goldenSampleCount }, stats: { ...current.stats, goldenSamples: goldenSampleCount } };
      });
      showSuccess(copy.feedback.sampleAdded);
      return;
    }
    setBusy('sample');
    setNotice(null);
    try {
      await fetchApi('/v1/writer/samples', {
        method: 'POST',
        body: JSON.stringify({
          kind: input.kind,
          origin: input.origin,
          label: input.label || undefined,
          content: input.content,
          source_url: input.sourceUrl,
          source_post_item_id: input.sourcePostItemId,
        }),
      });
      showSuccess(copy.feedback.sampleAdded);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  async function rebuildDna() {
    if (demoMode) {
      setData((current) => ({ ...current, dna: { ...current.dna, version: (current.dna.version ?? 0) + 1, status: 'active', confidence: current.dna.goldenSampleCount >= 5 ? 'reliable' : 'preliminary' } }));
      showSuccess(copy.feedback.rebuildStarted);
      return;
    }
    setBusy('rebuild');
    setNotice(null);
    try {
      await fetchApi('/v1/writer/dna/rebuild', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      showSuccess(copy.feedback.rebuildStarted);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(null);
    }
  }

  function handleSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = nextWriterSection(section, event.key, WRITER_SECTIONS);
    if (next === section) return;
    event.preventDefault();
    setSection(next);
    tabRefs.current[next]?.focus();
  }

  function startDemo() {
    const demo = createWriterDemoData(data.workspaceName);
    setData(demo);
    setEnabled(demo.policy.enabled);
    setDemoMode(true);
    setSection('today');
    setNotice({ tone: 'success', message: 'Testmodus aktiv: Alle Aktionen bleiben lokal und veröffentlichen nichts.' });
  }

  return (
    <div className="space-y-6">
      <section className="relative isolate overflow-hidden rounded-[2rem] border border-gray-200/75 bg-[#fbfcff] px-5 py-7 shadow-[0_30px_90px_-55px_rgba(15,23,42,0.4)] sm:px-8 sm:py-10 lg:px-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_12%,rgba(219,234,254,0.95),transparent_30%),radial-gradient(circle_at_88%_15%,rgba(224,231,255,0.8),transparent_24%),linear-gradient(to_bottom_right,rgba(255,255,255,0.96),rgba(248,250,252,0.8))]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[8%] top-7 -z-10 size-24 animate-pulse rounded-full bg-primary-200/40 blur-3xl motion-reduce:animate-none"
        />

        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-700">
                {copy.eyebrow}
              </span>
              <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600 ring-1 ring-gray-200">
                {copy.pilot}
              </span>
            </div>
            <h1 className="mt-4 max-w-3xl text-balance text-3xl font-semibold tracking-[-0.04em] text-gray-950 sm:text-4xl lg:text-[2.75rem] lg:leading-[1.06]">
              {copy.title}
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-gray-600 sm:text-base">
              {copy.subtitle}
            </p>
            <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gray-800">
              <span
                aria-hidden="true"
                className="flex size-6 items-center justify-center rounded-full bg-green-100 text-xs text-green-700"
              >
                ✓
              </span>
              {copy.approvalPromise}
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:flex-col lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 ring-inset ${
                  enabled
                    ? 'bg-green-50 text-green-700 ring-green-600/15'
                    : 'bg-amber-50 text-amber-800 ring-amber-600/15'
                }`}
              >
                <span aria-hidden="true" className="mr-1.5">
                  {enabled ? '●' : 'Ⅱ'}
                </span>
                {enabled ? copy.status.active : copy.status.paused}
              </span>
              <span className="inline-flex min-h-8 items-center rounded-full bg-white/80 px-3 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-200">
                {copy.status.approvalRequired}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                loading={policyBusy}
                disabled={blocked || !configured || (busy !== null && !policyBusy)}
                onClick={() => void updatePolicy()}
                className="min-h-11 bg-white/85 backdrop-blur"
              >
                {enabled ? copy.actions.pause : copy.actions.resume}
              </Button>
              {!enabled && (
                <Button
                  type="button"
                  loading={busy === 'run'}
                  disabled={(!configured && !demoMode) || busy !== null}
                  onClick={() => (blocked && !demoMode ? startDemo() : void runShadow())}
                  className="min-h-11 rounded-xl shadow-[0_12px_28px_-16px_rgba(37,99,235,0.95)]"
                >
                  {busy === 'run' ? copy.actions.running : copy.actions.runShadow}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {!demoMode && initialData.availability !== 'ready' && (
        <SetupState availability={initialData.availability} copy={copy} onStartDemo={startDemo} />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <WriterStat value={data.stats.awaitingApproval} label={copy.stats.awaiting} tone="blue" />
        <WriterStat value={data.stats.preparing} label={copy.stats.preparing} tone="gray" />
        <WriterStat value={data.stats.goldenSamples} label={copy.stats.learned} tone="green" />
        <WriterStat value={data.stats.exceptions} label={copy.stats.exceptions} tone="amber" />
      </div>

      <nav
        role="tablist"
        aria-label="Writer"
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-gray-100/80 p-1 ring-1 ring-inset ring-gray-200/70"
      >
        {WRITER_SECTIONS.map((item) => (
          <button
            key={item}
            ref={(node) => {
              tabRefs.current[item] = node;
            }}
            id={`writer-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={section === item}
            aria-controls={`writer-panel-${item}`}
            tabIndex={section === item ? 0 : -1}
            onClick={() => setSection(item)}
            onKeyDown={handleSectionKeyDown}
            className={`min-h-11 min-w-max rounded-xl px-4 text-sm font-semibold transition-[color,background-color,box-shadow] duration-200 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
              section === item
                ? 'bg-white text-gray-950 shadow-sm'
                : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {copy.sections[item]}
          </button>
        ))}
      </nav>

      <div aria-live="polite" aria-atomic="true">
        {notice && (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-2xl border px-4 py-3 text-sm ${
              notice.tone === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {notice.message}
          </div>
        )}
      </div>

      {section === 'today' && (
        <section
          id="writer-panel-today"
          role="tabpanel"
          aria-labelledby="writer-tab-today"
          className="space-y-5"
        >
          {!enabled && configured && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/65 px-4 py-3 text-sm leading-6 text-amber-950">
              <span aria-hidden="true" className="mt-0.5">
                Ⅱ
              </span>
              <p>{copy.today.pausedBody}</p>
            </div>
          )}

          {data.pendingReview ? (
            <ReviewCard
              key={data.pendingReview.id}
              review={data.pendingReview}
              copy={copy}
              disabled={blocked && !demoMode}
              busy={
                busy === 'approve' ||
                busy === 'edit' ||
                busy === 'alternate' ||
                busy === 'reject'
                  ? busy
                  : null
              }
              onApprove={approve}
              onEdit={edit}
              onAlternate={alternate}
              onReject={reject}
            />
          ) : (
            <EmptyToday copy={copy} disabled={(blocked && !demoMode) || !configured} onRun={runShadow} busy={busy} />
          )}
        </section>
      )}

      {section === 'dna' && (
        <ContentDnaPanel
          dna={data.dna}
          copy={copy}
          disabled={blocked && !demoMode}
          busy={busy === 'sample' || busy === 'rebuild' ? busy : null}
          onAddSample={addSample}
          onRebuild={rebuildDna}
        />
      )}

      {section === 'history' && <WriterHistory history={data.history} copy={copy} />}
    </div>
  );
}

function SetupState({
  availability,
  copy,
  onStartDemo,
}: {
  availability: WriterUiData['availability'];
  copy: WriterCopy;
  onStartDemo: () => void;
}) {
  const content =
    availability === 'migration_pending'
      ? { title: copy.setup.migrationTitle, body: copy.setup.migrationBody, tone: 'amber' }
      : availability === 'unavailable'
        ? { title: copy.setup.unavailableTitle, body: copy.setup.unavailableBody, tone: 'red' }
        : { title: copy.setup.setupTitle, body: copy.setup.setupBody, tone: 'blue' };
  return (
    <section
      className={`rounded-2xl border px-5 py-4 ${
        content.tone === 'red'
          ? 'border-red-200 bg-red-50/70'
          : content.tone === 'amber'
            ? 'border-amber-200 bg-amber-50/70'
            : 'border-blue-200 bg-blue-50/70'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm"
        >
          {content.tone === 'red' ? '!' : content.tone === 'amber' ? 'Ⅱ' : '✦'}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-gray-950">{content.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{content.body}</p>
          <p className="mt-2 text-xs font-medium text-gray-500">{copy.setup.safeNote}</p>
          <Button type="button" onClick={onStartDemo} className="mt-4 min-h-10">
            Testmodus starten
          </Button>
        </div>
      </div>
    </section>
  );
}

function WriterStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: 'blue' | 'gray' | 'green' | 'amber';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-800',
  }[tone];
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-4 shadow-[0_14px_35px_-28px_rgba(15,23,42,0.4)] sm:px-5">
      <span className={`inline-flex min-w-9 justify-center rounded-xl px-2.5 py-1 text-lg font-semibold ${toneClass}`}>
        {value}
      </span>
      <p className="mt-3 text-xs font-medium leading-5 text-gray-500 sm:text-sm">{label}</p>
    </div>
  );
}

function EmptyToday({
  copy,
  disabled,
  onRun,
  busy,
}: {
  copy: WriterCopy;
  disabled: boolean;
  onRun: () => Promise<void>;
  busy: BusyAction;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <div
        aria-hidden="true"
        className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gray-950 text-xl text-white shadow-lg"
      >
        ✦
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-gray-950">
        {copy.today.emptyTitle}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-500">{copy.today.emptyBody}</p>
      <Button
        type="button"
        className="mt-6 min-h-11 rounded-xl"
        loading={busy === 'run'}
        disabled={disabled || busy !== null}
        onClick={() => void onRun()}
      >
        {busy === 'run' ? copy.actions.running : copy.actions.runShadow}
      </Button>
    </section>
  );
}

function WriterHistory({
  history,
  copy,
}: {
  history: WriterHistoryEntry[];
  copy: WriterCopy;
}) {
  return (
    <section
      id="writer-panel-history"
      role="tabpanel"
      aria-labelledby="writer-tab-history"
      className="rounded-3xl border border-gray-200/80 bg-white p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.3)] sm:p-7"
    >
      <h2 className="text-xl font-semibold tracking-tight text-gray-950">{copy.history.title}</h2>
      <p className="mt-1 text-sm leading-6 text-gray-500">{copy.history.subtitle}</p>

      {history.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-semibold text-gray-800">{copy.history.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-gray-500">
            {copy.history.emptyBody}
          </p>
        </div>
      ) : (
        <ol className="mt-6 divide-y divide-gray-100">
          {history.map((entry) => (
            <li key={entry.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="text-sm font-semibold text-gray-900">{entry.title}</p>
                <p className="mt-1 text-sm leading-6 text-gray-500">{entry.detail}</p>
              </div>
              <div className="flex items-center gap-3 sm:justify-end">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    entry.status === 'approved'
                      ? 'bg-green-50 text-green-700'
                      : entry.status === 'rejected'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {copy.history.statuses[entry.status]}
                </span>
                <time dateTime={entry.occurredAt} className="text-xs text-gray-400">
                  {entry.occurredAt}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
