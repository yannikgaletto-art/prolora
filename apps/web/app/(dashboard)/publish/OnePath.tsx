'use client';

// GOAL-RUN11 One Path: /publish is one screen with three states —
// say → review → done. Prolora decides (text, channel, timing), the user
// corrects via four inline links. Nothing publishes without the explicit
// Posten click (RUN9 D4); media generation only appears in review (D2).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { AngleSuggestion, AppLocale, CreatePostResponse, MediaItem } from '@prolora/shared';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Textarea } from '@/app/components/Input';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { ConnectionWithLimit } from '@/lib/connections/list-connections';
import type { FeatureState } from '@/lib/system/doctor';
import type { PrepareResult, PreparedDraft } from '@/lib/publish/prepare';
import { getOnePathDict } from '@/lib/i18n/onepath';
import { getRun7Dict } from '@/lib/i18n/run7';
import { PLATFORM_META } from './platform-meta';
import { storeAppliedTemplate, takeAppliedTemplate } from './handoff';
import { useSpeechInput } from './templates/useSpeechInput';
import { MediaCard } from './MediaCard';
import { PostPreview } from './PostPreview';

type Stage = 'say' | 'review' | 'done';
type TimingMode = 'now' | 'slot' | 'custom';
type OpenEditor = 'text' | 'media' | 'channels' | 'timing' | null;

interface AttachedMedia {
  item: MediaItem;
  previewUrl: string | null;
}

const MAX_SCHEDULE_DAYS = 60;

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function OnePath({
  connections,
  locale,
  mediaFeature,
  suggestions = [],
}: {
  connections: ConnectionWithLimit[];
  locale: AppLocale;
  mediaFeature: FeatureState;
  /** "Prolora empfiehlt heute" — deterministic, 0 credits; empty w/o profile. */
  suggestions?: AngleSuggestion[];
}) {
  const dict = getOnePathDict(locale);
  const run7 = getRun7Dict(locale);
  const speech = useSpeechInput(locale);

  const [stage, setStage] = useState<Stage>('say');
  const [topic, setTopic] = useState('');
  const [preparing, setPreparing] = useState(false);
  /** Which trigger is loading: 'topic' or 'suggestion-<index>' — for spinners. */
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [draft, setDraft] = useState<PreparedDraft | null>(null);
  const [alternatives, setAlternatives] = useState<PreparedDraft[]>([]);
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
  // Kein eigener Editor auf dem One Path — aber ein per Handoff (Wizard/
  // geführter Entwurf) mitgelieferter First Comment darf nie stumm verloren
  // gehen: er bleibt erhalten, erscheint in der Preview und wird mitgesendet.
  const [firstComment, setFirstComment] = useState('');
  const [suggestedSlot, setSuggestedSlot] = useState<{ instant: string; timezone: string } | null>(
    null
  );
  const [timingMode, setTimingMode] = useState<TimingMode>('now');
  const [customAt, setCustomAt] = useState('');
  const [openEditor, setOpenEditor] = useState<OpenEditor>(null);
  const [connectPrompt, setConnectPrompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [wasScheduled, setWasScheduled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const activeConnections = useMemo(
    () => connections.filter((connection) => connection.status === 'active'),
    [connections]
  );

  // Handoff landing zone: the guided draft (/publish/start), the template
  // wizard, and our own connect round-trip all arrive here as review state.
  useEffect(() => {
    const result = takeAppliedTemplate(Date.now());
    if (result.status === 'applied') {
      setContent(result.payload.content);
      setFirstComment(result.payload.firstComment ?? '');
      setSelected(
        result.payload.connectionIds.length > 0
          ? new Set(result.payload.connectionIds)
          : new Set(activeConnections.map((connection) => connection.connection_id))
      );
      if (result.payload.media) {
        setAttachedMedia(
          result.payload.media.slice(0, 4).map((media) => ({
            item: {
              type: media.type,
              url: media.url,
              mime_type: media.mime_type,
              alt_text: media.alt_text,
            },
            previewUrl: media.preview_url ?? null,
          }))
        );
      }
      setStage('review');
    }
    // Mount-only by design — the handoff is read-and-clear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minSchedule = useMemo(() => toLocalInputValue(new Date()), []);
  const maxSchedule = useMemo(
    () => toLocalInputValue(new Date(Date.now() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000)),
    []
  );

  const selectedConnections = useMemo(
    () => connections.filter((connection) => selected.has(connection.connection_id)),
    [connections, selected]
  );

  function enterReview(result: PrepareResult) {
    setDraft(result.draft);
    setAlternatives(result.alternatives);
    setContent(result.draft?.content ?? '');
    setSelected(new Set(activeConnections.map((connection) => connection.connection_id)));
    setSuggestedSlot(result.suggested_slot);
    setTimingMode('now');
    setCustomAt('');
    setAttachedMedia([]);
    setFirstComment('');
    setOpenEditor(null);
    setConnectPrompt(false);
    setStage('review');
  }

  async function runPrepare(body: { topic?: string; angle?: string }) {
    setError(null);
    setFollowUps([]);
    setPreparing(true);
    try {
      const result = await fetchApi<PrepareResult>('/v1/publish/prepare', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!result.draft) {
        setFollowUps(result.follow_up_questions);
        return;
      }
      enterReview(result);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPreparing(false);
      setPreparingKey(null);
    }
  }

  async function handlePrepare() {
    if (topic.trim().length < 3) {
      setError(dict.say.tooShort);
      return;
    }
    setPreparingKey('topic');
    await runPrepare({ topic: topic.trim() });
  }

  // Vorschlag angeklickt (der zweite Weg neben dem eigenen Thema): der Angle
  // trägt den Post; ein zusätzlich getipptes Thema fließt als Kontext mit ein.
  async function handlePickSuggestion(suggestion: AngleSuggestion, index: number) {
    setPreparingKey(`suggestion-${index}`);
    await runPrepare({
      angle: suggestion.angle,
      topic: topic.trim().length >= 3 ? topic.trim() : undefined,
    });
  }

  function swapAlternative() {
    if (alternatives.length === 0) {
      setToast({ variant: 'info', message: dict.review.noAlternatives });
      return;
    }
    const [next, ...rest] = alternatives;
    setAlternatives(draft ? [...rest, draft] : rest);
    setDraft(next);
    setContent(next.content);
  }

  function scheduledAtIso(): { iso?: string; tz?: string } | { invalid: string } {
    if (timingMode === 'now') return {};
    if (timingMode === 'slot' && suggestedSlot) {
      return { iso: suggestedSlot.instant, tz: suggestedSlot.timezone };
    }
    if (!customAt) return { invalid: 'Choose a date and time first.' };
    const date = new Date(customAt);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60_000) {
      return { invalid: 'That schedule time is not valid.' };
    }
    return { iso: date.toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }

  async function handlePost() {
    setError(null);
    if (selectedConnections.length === 0) {
      // Just-in-time connect (D4): park the finished post, send the user to
      // Connections, restore on return via the handoff mount effect above.
      setConnectPrompt(true);
      return;
    }
    const schedule = scheduledAtIso();
    if ('invalid' in schedule) {
      setError(schedule.invalid);
      return;
    }
    const platformKinds = new Set(selectedConnections.map((connection) => connection.platform));
    setSubmitting(true);
    try {
      await fetchApi<CreatePostResponse>('/v1/posts', {
        method: 'POST',
        body: JSON.stringify({
          content,
          platforms: [...selected],
          adapt_content: platformKinds.size > 1 || undefined,
          output_language: platformKinds.size > 1 ? (locale === 'de' ? 'de' : 'en') : undefined,
          scheduled_at: schedule.iso,
          scheduled_tz: schedule.iso ? schedule.tz : undefined,
          first_comment: firstComment.trim() || undefined,
          media: attachedMedia.length > 0 ? attachedMedia.map(({ item }) => item) : undefined,
        }),
      });
      setWasScheduled(Boolean(schedule.iso));
      setStage('done');
    } catch (requestError) {
      setToast({ variant: 'error', message: errorMessage(requestError) });
    } finally {
      setSubmitting(false);
    }
  }

  function parkDraftAndConnect() {
    storeAppliedTemplate(
      {
        content,
        connectionIds: [],
        extras: null,
        media: attachedMedia.map(({ item, previewUrl }) => ({
          type: item.type,
          url: item.url,
          mime_type: item.mime_type,
          alt_text: item.alt_text,
          preview_url: previewUrl ?? undefined,
        })),
      },
      Date.now()
    );
  }

  function resetToSay() {
    setStage('say');
    setTopic('');
    setDraft(null);
    setAlternatives([]);
    setContent('');
    setSelected(new Set());
    setAttachedMedia([]);
    setFirstComment('');
    setFollowUps([]);
    setOpenEditor(null);
    setConnectPrompt(false);
    setError(null);
  }

  const timingLabel =
    timingMode === 'now'
      ? dict.review.now
      : timingMode === 'slot' && suggestedSlot
        ? `${dict.review.slot} · ${suggestedSlot.timezone}`
        : customAt || dict.review.custom;

  const channelLabel =
    selectedConnections.length === 0
      ? dict.review.noChannels
      : selectedConnections.length === 1
        ? `${dict.review.channel}: ${PLATFORM_META[selectedConnections[0].platform].label}`
        : `${dict.review.channels}: ${selectedConnections.length}`;

  // ---- Stage 1: Sagen -------------------------------------------------------
  if (stage === 'say') {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{dict.say.title}</h1>
        </div>
        <Card>
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label={dict.say.title}
              rows={4}
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder={dict.say.placeholder}
              disabled={preparing}
            />
            {speech.supported && !speech.blocked && (
              <button
                type="button"
                onClick={() => {
                  if (speech.activeKey === 'onepath') {
                    speech.stop();
                    return;
                  }
                  speech.start('onepath', (text) =>
                    setTopic((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text))
                  );
                }}
                className={`self-start rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  speech.activeKey === 'onepath'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                aria-pressed={speech.activeKey === 'onepath'}
              >
                {speech.activeKey === 'onepath'
                  ? run7.composer.stopDictation
                  : `🎙 ${run7.composer.dictate}`}
              </button>
            )}
            {followUps.length > 0 && (
              <div className="rounded-md bg-gray-50 px-4 py-3">
                <p className="text-sm font-medium text-gray-900">{dict.review.followUpTitle}</p>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-sm text-gray-700">
                  {followUps.map((question, index) => (
                    <li key={index}>{question}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-gray-500">{dict.review.followUpHint}</p>
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              type="button"
              onClick={() => void handlePrepare()}
              loading={preparing && preparingKey === 'topic'}
              disabled={preparing}
            >
              {preparing && preparingKey === 'topic' ? dict.say.preparing : dict.say.submit}
            </Button>
            {preparing && (
              <p className="text-center text-xs text-gray-500" role="status">
                {dict.say.preparingHint}
              </p>
            )}
          </div>
        </Card>

        {/* Der zweite Weg (RUN11-Follow-up): Prolora kennt das Produkt und
            schlägt drei fertige Blickwinkel vor — deterministisch, 0 Credits.
            Erst der Klick auf einen Vorschlag kostet den einen Draft-Credit. */}
        {suggestions.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.12em] text-gray-400">
              {dict.say.orPick}
            </p>
            {suggestions.slice(0, 3).map((suggestion, index) => (
              <button
                key={`${suggestion.lens}-${index}`}
                type="button"
                disabled={preparing}
                onClick={() => void handlePickSuggestion(suggestion, index)}
                className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                  preparingKey === `suggestion-${index}`
                    ? 'border-primary-400 ring-1 ring-primary-200'
                    : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/40'
                } disabled:opacity-60`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-semibold text-gray-900">{suggestion.title}</span>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {suggestion.structure_label}
                  </span>
                </span>
                <span className="mt-1 block text-sm text-gray-600">{suggestion.angle}</span>
                <span className="mt-2 block text-xs text-gray-400">
                  {preparingKey === `suggestion-${index}`
                    ? dict.say.preparing
                    : suggestion.why_this_fits}
                </span>
              </button>
            ))}
          </div>
        )}
        <p className="text-center text-xs text-gray-500">
          <Link href="/publish/start" className="hover:text-primary-700 hover:underline">
            {dict.say.guidedLink} →
          </Link>
        </p>
      </div>
    );
  }

  // ---- Stage 3: Fertig ------------------------------------------------------
  if (stage === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 py-16 text-center">
        <span aria-hidden="true" className="text-4xl">🎉</span>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          {wasScheduled ? dict.done.titleScheduled : dict.done.title}
        </h1>
        <p className="text-sm text-gray-600">
          {wasScheduled ? dict.done.bodyScheduled : dict.done.body}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Link
            href="/publish/posts"
            className="inline-flex items-center justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            {dict.done.viewPosts}
          </Link>
          <Button type="button" onClick={resetToSay}>
            {dict.done.next}
          </Button>
        </div>
      </div>
    );
  }

  // ---- Stage 2: Prüfen ------------------------------------------------------
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 py-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">{dict.review.title}</h1>
        <p className="mt-1 text-sm text-gray-500">{dict.review.subtitle}</p>
      </div>

      {selectedConnections.length > 0 ? (
        <PostPreview
          locale={locale}
          connections={connections}
          selected={selected}
          content={content}
          contentByConnection={{}}
          firstComment={firstComment}
          media={attachedMedia}
          unicodeBoldEnabled={false}
        />
      ) : (
        <Card>
          <article className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="whitespace-pre-wrap text-sm text-gray-900">{content}</p>
          </article>
        </Card>
      )}

      {draft?.rationale && (
        <details className="rounded-md bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
          <summary className="cursor-pointer text-xs font-medium text-gray-500">
            {dict.review.whyThis}
          </summary>
          <p className="mt-1.5">{draft.rationale}</p>
        </details>
      )}

      {/* The four correction links (D1) — each opens inline, never a new page. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {(
          [
            ['text', dict.review.editText],
            ['media', attachedMedia.length > 0 ? dict.review.changeMedia : dict.review.addMedia],
            ['channels', channelLabel],
            ['timing', `${dict.review.timing}: ${timingLabel}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setOpenEditor((current) => (current === key ? null : key))}
            aria-expanded={openEditor === key}
            className={`font-medium ${
              openEditor === key ? 'text-primary-800 underline' : 'text-primary-700 hover:underline'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={swapAlternative}
          className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          ↺ {dict.review.tryAnother}
        </button>
      </div>

      {openEditor === 'text' && (
        <Card>
          <div className="flex flex-col gap-2">
            <Textarea
              aria-label={dict.review.editText}
              rows={8}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setOpenEditor(null)}
              className="self-end text-xs font-medium text-primary-700 hover:underline"
            >
              {dict.review.doneEditing}
            </button>
          </div>
        </Card>
      )}

      {openEditor === 'media' && (
        <div className="flex flex-col gap-3">
          {attachedMedia.length > 0 && (
            <Card title={run7.composer.attachedMedia}>
              <ul className="space-y-2">
                {attachedMedia.map(({ item }, index) => (
                  <li
                    key={`${item.url}-${index}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate text-gray-700">
                      {item.type} · {item.url}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-medium text-red-600"
                      onClick={() =>
                        setAttachedMedia((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index)
                        )
                      }
                    >
                      {run7.composer.remove}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <MediaCard
            locale={locale}
            featureState={mediaFeature}
            onUse={(item, previewUrl) =>
              setAttachedMedia((current) => [...current, { item, previewUrl }].slice(0, 4))
            }
          />
        </div>
      )}

      {openEditor === 'channels' && (
        <Card title={dict.review.channels}>
          {activeConnections.length > 0 ? (
            <div className="flex flex-col gap-2">
              {activeConnections.map((connection) => {
                const meta = PLATFORM_META[connection.platform];
                const checked = selected.has(connection.connection_id);
                return (
                  <label
                    key={connection.connection_id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 ${
                      checked
                        ? 'border-primary-300 bg-primary-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(connection.connection_id)) {
                            next.delete(connection.connection_id);
                          } else {
                            next.add(connection.connection_id);
                          }
                          return next;
                        })
                      }
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
                      <span className="block text-xs text-gray-500">{meta.label}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-600">{dict.post.connectBody}</p>
          )}
        </Card>
      )}

      {openEditor === 'timing' && (
        <Card title={dict.review.timing}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input
                  type="radio"
                  name="onepath-timing"
                  checked={timingMode === 'now'}
                  onChange={() => setTimingMode('now')}
                  className="h-4 w-4 text-primary-600"
                />
                {dict.review.now}
              </label>
              {suggestedSlot && (
                <label className="flex items-center gap-2 text-sm text-gray-900">
                  <input
                    type="radio"
                    name="onepath-timing"
                    checked={timingMode === 'slot'}
                    onChange={() => setTimingMode('slot')}
                    className="h-4 w-4 text-primary-600"
                  />
                  {dict.review.slot} · {new Date(suggestedSlot.instant).toLocaleString(locale)}
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input
                  type="radio"
                  name="onepath-timing"
                  checked={timingMode === 'custom'}
                  onChange={() => setTimingMode('custom')}
                  className="h-4 w-4 text-primary-600"
                />
                {dict.review.custom}
              </label>
            </div>
            {timingMode === 'custom' && (
              <input
                type="datetime-local"
                value={customAt}
                min={minSchedule}
                max={maxSchedule}
                onChange={(event) => setCustomAt(event.target.value)}
                className="block w-full max-w-xs rounded-md border-0 px-3 py-2 text-sm text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-primary-600"
              />
            )}
          </div>
        </Card>
      )}

      {connectPrompt && selectedConnections.length === 0 && (
        <Card>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-gray-900">{dict.post.connectTitle}</p>
            <p className="text-sm text-gray-600">{dict.post.connectBody}</p>
            <div className="mt-1 flex items-center gap-3">
              <Link
                href="/connections"
                onClick={parkDraftAndConnect}
                className="inline-flex items-center justify-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
              >
                {dict.post.connectCta}
              </Link>
              <button
                type="button"
                onClick={() => setConnectPrompt(false)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                {dict.post.connectBack}
              </button>
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={resetToSay}
          className="text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          ← {dict.review.startOver}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="button" onClick={() => void handlePost()} loading={submitting}>
          {submitting
            ? dict.post.submitting
            : timingMode === 'now'
              ? dict.post.submit
              : dict.post.submitScheduled}
        </Button>
      </div>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
