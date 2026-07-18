'use client';

// Guided template wizard (GOAL-RUN5 G2) — own page, one decision per step
// (user feedback #1/#2): Ziel → Anlass → Vorlage → Ausfüllen, with a draft
// preview before the composer handoff (V1). URL query carries the real
// decisions; skipped steps are resolved by wizard-logic and written back via
// replaceState so the Back button never bounces (V4.8). Catalog content is
// German by design; the chrome is trilingual (dict prop).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type {
  AppLocale,
  PostTemplateSummary,
  SlotSuggestion,
  TemplateDraftResponse,
  TemplateDraftResult,
  TemplatePrefillResponse,
  TemplateSlot,
} from '@prolora/shared';
import { Badge } from '@/app/components/Badge';
import { Button } from '@/app/components/Button';
import { ChoiceCard } from '@/app/components/ChoiceCard';
import { Spinner } from '@/app/components/Spinner';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { stepTransition } from '@/app/components/motion';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { ConnectionWithLimit } from '@/lib/connections/list-connections';
import { APP_LOCALES, LOCALE_COOKIE, fill, type WizardDict } from '@/lib/i18n';
import { stepPlanFor, templatesFor } from '@/lib/templates/guide';
import { localizedAnlaesseForGoal, localizedIntentInfo } from '@/lib/templates/localization';
import { PLATFORM_META } from '../platform-meta';
import { storeAppliedTemplate } from '../handoff';
import { SlotField } from './SlotField';
import { useSpeechInput } from './useSpeechInput';
import type { FeatureState } from '@/lib/system/doctor';
import {
  buildQuery,
  parseWizardState,
  prefillCacheKey,
  readCachedSuggestions,
  readStoredSlots,
  slotsStorageKey,
  targetPlatformsFor,
  writeCachedSuggestions,
  writeStoredSlots,
} from './wizard-logic';

const MIC_NOTICE_KEY = 'prolora:mic-privacy-seen';

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export interface TemplateGuideProps {
  /** prompt_hints already stripped server-side (Oracle O3). */
  templates: PostTemplateSummary[];
  connections: ConnectionWithLimit[];
  contextAvailable: boolean;
  aiEnabled: boolean;
  aiFeature: FeatureState;
  creditsLimit: number;
  creditsUsed: number;
  workspaceId: string;
  locale: AppLocale;
  dict: WizardDict;
}

export function TemplateGuide({
  templates,
  connections,
  contextAvailable,
  aiEnabled,
  aiFeature,
  creditsLimit,
  creditsUsed,
  workspaceId,
  locale,
  dict,
}: TemplateGuideProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reduced = useReducedMotion();
  const speech = useSpeechInput(locale);

  const state = useMemo(
    () => parseWizardState(new URLSearchParams(searchParams.toString()), templates),
    [searchParams, templates]
  );
  const template = state.templateId
    ? templates.find((t) => t.id === state.templateId)
    : undefined;

  // Local UI state ----------------------------------------------------------
  const [expandedChoice, setExpandedChoice] = useState<string | null>(
    state.autoExpandTemplateId ?? null
  );
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [prefillStatus, setPrefillStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [generating, setGenerating] = useState<'ai' | 'scaffold' | null>(null);
  const [draft, setDraft] = useState<TemplateDraftResult | null>(null);
  const [slotError, setSlotError] = useState<{ key: string; message: string } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [showMicNotice, setShowMicNotice] = useState(false);
  const [noSpeechKey, setNoSpeechKey] = useState<string | null>(null);
  // null until mounted — the server render must not depend on localStorage.
  const [cachedIds, setCachedIds] = useState<Set<string> | null>(null);

  // Draft preview is a step-4 SUBSTATE: browser Back changes the URL step
  // underneath it, so the preview only renders while the URL still says 4 —
  // otherwise Back from the preview would show a blank wizard.
  const showPreview = draft !== null && state.step === 4 && template !== undefined;
  const contentKey = showPreview ? 'preview' : `step-${state.step}`;

  const h1Ref = useRef<HTMLHeadingElement>(null);
  const slotRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const slotValuesRef = useRef<Record<string, string>>({});
  useEffect(() => {
    slotValuesRef.current = slotValues;
  }, [slotValues]);
  const loadedTemplateIdRef = useRef<string | null>(null);
  useEffect(() => {
    loadedTemplateIdRef.current = loadedTemplateId;
  }, [loadedTemplateId]);
  /** Template the user consented to prefill via the labelled step-3 CTA (V2). */
  const consentedTemplateRef = useRef<string | null>(null);
  /** Dedupes the paid prefill POST across step re-entries and StrictMode. */
  const prefillAttemptedRef = useRef<string | null>(null);
  // Focus moves when the step content actually changed — but only after the
  // enter animation: under AnimatePresence mode="wait" an immediate focus()
  // lands on the EXITING node and falls back to <body>.
  const pendingFocusRef = useRef(false);
  const currentKeyRef = useRef(contentKey);
  const prevKeyRef = useRef(contentKey);
  useEffect(() => {
    currentKeyRef.current = contentKey;
    if (prevKeyRef.current !== contentKey) {
      prevKeyRef.current = contentKey;
      pendingFocusRef.current = true;
    }
  });

  const activePlatforms = useMemo(
    () => new Set(connections.filter((c) => c.status === 'active').map((c) => c.platform)),
    [connections]
  );

  // Navigation ---------------------------------------------------------------
  // window.history + useSearchParams (Next 15 shallow routing): the URL is the
  // single source of truth, so refresh and deep links land on a valid step.
  const navigate = useCallback(
    (query: string, mode: 'push' | 'replace') => {
      const url = `${pathname}${query}`;
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [pathname]
  );

  // Canonicalize invalid/stale URLs without polluting history (D8).
  useEffect(() => {
    const current = searchParams.toString();
    const canonical = state.canonicalQuery.replace(/^\?/, '');
    if (current !== canonical) navigate(state.canonicalQuery, 'replace');
  }, [searchParams, state.canonicalQuery, navigate]);

  function chooseGoal(goal: PostTemplateSummary['intent']) {
    const plan = stepPlanFor(templates, goal);
    // A skipped Anlass is materialized in the same push — Back returns to
    // step 1 in one hop instead of bouncing off the skipped step.
    if (plan.skipAnlass && plan.soleAnlassKey) {
      navigate(buildQuery({ goal, anlass: plan.soleAnlassKey }), 'push');
    } else {
      navigate(buildQuery({ goal }), 'push');
    }
  }

  function chooseAnlass(anlassKey: string) {
    if (!state.goal) return;
    navigate(buildQuery({ goal: state.goal, anlass: anlassKey }), 'push');
  }

  function chooseTemplate(templateId: string) {
    if (!state.goal || !state.anlassKey) return;
    // The labelled CTA click IS the informed consent for the paid prefill (V2)
    // — deep links and reloads never trigger a charge without it.
    consentedTemplateRef.current = templateId;
    navigate(buildQuery({ goal: state.goal, anlass: state.anlassKey, template: templateId }), 'push');
  }

  function goBack() {
    if (draft) {
      setDraft(null);
      return;
    }
    if (state.step === 4) {
      navigate(buildQuery({ goal: state.goal, anlass: state.anlassKey }), 'push');
    } else if (state.step === 3) {
      navigate(state.anlassAutoResolved ? buildQuery({}) : buildQuery({ goal: state.goal }), 'push');
    } else if (state.step === 2) {
      navigate(buildQuery({}), 'push');
    }
  }

  // Step-change side effects: stop a running dictation (it must never write
  // into another step's state) and drop a stale draft preview.
  const stopSpeech = speech.stop;
  const prevStepRef = useRef(state.step);
  useEffect(() => {
    if (prevStepRef.current === state.step) return;
    prevStepRef.current = state.step;
    stopSpeech();
    setDraft(null);
  }, [state.step, stopSpeech]);

  // Expansion follows the URL context — including same-step goal/anlass changes.
  useEffect(() => {
    setExpandedChoice(state.step === 3 ? (state.autoExpandTemplateId ?? null) : null);
  }, [state.step, state.goal, state.anlassKey, state.autoExpandTemplateId]);

  // Which templates already have cached suggestions (client-only, post-mount —
  // keeps server and first client render identical).
  useEffect(() => {
    const storage = getLocalStorage();
    setCachedIds(
      new Set(
        templates
          .filter((t) => readCachedSuggestions(storage, prefillCacheKey(workspaceId, t.id)) !== null)
          .map((t) => t.id)
      )
    );
  }, [templates, workspaceId]);

  // Slot answers: load persisted values when the template changes (T5.5).
  useEffect(() => {
    if (!state.templateId) return;
    stopSpeech();
    setSlotValues(readStoredSlots(getSessionStorage(), slotsStorageKey(state.templateId)));
    setAiKeys(new Set());
    setDraft(null);
    setSlotError(null);
    setNoSpeechKey(null);
    setPrefillStatus('idle');
    setLoadedTemplateId(state.templateId);
  }, [state.templateId, stopSpeech]);

  // Persist user answers (not AI-badged ones — those come back from the cache
  // with their badge intact instead of masquerading as user input).
  useEffect(() => {
    if (!loadedTemplateId || loadedTemplateId !== state.templateId) return;
    const persistable = Object.fromEntries(
      Object.entries(slotValues).filter(([key]) => !aiKeys.has(key))
    );
    writeStoredSlots(getSessionStorage(), slotsStorageKey(loadedTemplateId), persistable);
  }, [slotValues, aiKeys, loadedTemplateId, state.templateId]);

  const applySuggestions = useCallback(
    (suggestions: SlotSuggestion[], forTemplate: PostTemplateSummary) => {
      const angleKeys = new Set(
        forTemplate.slots.filter((s) => s.kind === 'angle').map((s) => s.key)
      );
      const current = slotValuesRef.current;
      // Never overwrite what the user already wrote; never fill non-angle slots.
      const applicable = suggestions.filter(
        (s) => !s.is_example && s.value.trim() && angleKeys.has(s.key) && !current[s.key]?.trim()
      );
      if (applicable.length === 0) return;
      setSlotValues((prev) => {
        const next = { ...prev };
        for (const s of applicable) {
          if (!next[s.key]?.trim()) next[s.key] = s.value;
        }
        return next;
      });
      setAiKeys((prev) => new Set([...prev, ...applicable.map((s) => s.key)]));
    },
    []
  );

  // Prefill on step-4 entry (D2/V2). The cache path is free and always runs;
  // the PAID call additionally needs the informed step-3 CTA click from this
  // session (consentedTemplateRef) and fires at most once per template
  // (prefillAttemptedRef — also covers StrictMode's double effect). Deliberately
  // NOT keyed on prefillStatus: that dependency would re-run the effect on the
  // 'loading' transition and cancel its own in-flight request.
  const angleSlotCount = template?.slots.filter((s) => s.kind === 'angle').length ?? 0;
  const prefillEligible = aiEnabled && contextAvailable && angleSlotCount > 0;
  useEffect(() => {
    if (state.step !== 4 || !template || !prefillEligible) return;
    if (loadedTemplateId !== template.id) return;
    const requestId = template.id;
    const cached = readCachedSuggestions(getLocalStorage(), prefillCacheKey(workspaceId, requestId));
    if (cached) {
      applySuggestions(cached, template);
      setPrefillStatus('done');
      return;
    }
    if (consentedTemplateRef.current !== requestId) return;
    if (prefillAttemptedRef.current === requestId) return;
    prefillAttemptedRef.current = requestId;
    setPrefillStatus('loading');
    fetchApi<TemplatePrefillResponse>('/v1/templates/prefill', {
      method: 'POST',
      body: JSON.stringify({ template_id: requestId }),
    })
      .then((response) => {
        writeCachedSuggestions(
          getLocalStorage(),
          prefillCacheKey(workspaceId, requestId),
          response.suggestions
        );
        setCachedIds((prev) => new Set([...(prev ?? []), requestId]));
        // A late response for a template the user already left updates only
        // the cache — never the current template's fields or status.
        if (loadedTemplateIdRef.current !== requestId) return;
        applySuggestions(response.suggestions, template);
        setPrefillStatus('done');
      })
      .catch(() => {
        // Non-blocking by design: the fields stay usable, examples guide.
        if (loadedTemplateIdRef.current === requestId) setPrefillStatus('error');
      });
  }, [state.step, template, prefillEligible, loadedTemplateId, workspaceId, applySuggestions]);

  async function regenerateSuggestions() {
    if (!template || prefillStatus === 'loading') return;
    const requestId = template.id;
    // Untouched AI values make room for the fresh batch; edited ones stay.
    setSlotValues((prev) => {
      const next = { ...prev };
      for (const key of aiKeys) delete next[key];
      return next;
    });
    setAiKeys(new Set());
    setPrefillStatus('loading');
    try {
      const response = await fetchApi<TemplatePrefillResponse>('/v1/templates/prefill', {
        method: 'POST',
        body: JSON.stringify({ template_id: requestId }),
      });
      writeCachedSuggestions(
        getLocalStorage(),
        prefillCacheKey(workspaceId, requestId),
        response.suggestions
      );
      setCachedIds((prev) => new Set([...(prev ?? []), requestId]));
      // Late response after a template switch: cache updated, fields untouched.
      if (loadedTemplateIdRef.current !== requestId) return;
      applySuggestions(response.suggestions, template);
      setPrefillStatus('done');
    } catch (error) {
      if (loadedTemplateIdRef.current !== requestId) return;
      setPrefillStatus('error');
      setToast({ variant: 'error', message: errorMessage(error) });
    }
  }

  // Dictation ----------------------------------------------------------------
  function handleSlotChange(key: string, value: string) {
    setSlotValues((prev) => ({ ...prev, [key]: value }));
    setAiKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (slotError?.key === key) setSlotError(null);
    if (noSpeechKey === key) setNoSpeechKey(null);
  }

  function handleMicToggle(slot: TemplateSlot) {
    if (speech.activeKey === slot.key) {
      speech.stop();
      return;
    }
    setNoSpeechKey(null);
    try {
      if (!window.localStorage.getItem(MIC_NOTICE_KEY)) setShowMicNotice(true);
    } catch {
      // Private mode: the notice simply shows again next time.
    }
    const templateAtStart = loadedTemplateIdRef.current;
    speech.start(slot.key, (text) => {
      // A late final result after a template switch must not leak across.
      if (loadedTemplateIdRef.current !== templateAtStart) return;
      setSlotValues((prev) => {
        const existing = prev[slot.key] ?? '';
        return { ...prev, [slot.key]: existing.trim() ? `${existing.trimEnd()} ${text}` : text };
      });
      setAiKeys((prev) => {
        if (!prev.has(slot.key)) return prev;
        const next = new Set(prev);
        next.delete(slot.key);
        return next;
      });
      // Dictating into the missing field resolves its validation error too.
      setSlotError((current) => (current?.key === slot.key ? null : current));
      setNoSpeechKey((current) => (current === slot.key ? null : current));
    });
  }

  function dismissMicNotice() {
    setShowMicNotice(false);
    try {
      window.localStorage.setItem(MIC_NOTICE_KEY, '1');
    } catch {
      // Best effort.
    }
  }

  // Speech error table (design spec): network → toast, no-speech → subtle
  // hint at the field that was recording.
  const lastMicKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (speech.activeKey) lastMicKeyRef.current = speech.activeKey;
  }, [speech.activeKey]);
  useEffect(() => {
    if (!speech.transientError) return;
    if (speech.transientError === 'network') {
      setToast({ variant: 'error', message: dict.mic_network_error });
    } else {
      setNoSpeechKey(lastMicKeyRef.current);
    }
    speech.dismissError();
  }, [speech, dict.mic_network_error]);

  // Draft generation & handoff ------------------------------------------------
  function isEffectivelyRequired(slot: TemplateSlot): boolean {
    return slot.required && !(slot.prefill_from && contextAvailable);
  }

  function applyDraft(result: TemplateDraftResult) {
    if (!template) return;
    const connectionIds = connections
      .filter((c) => c.status === 'active' && result.recommended_platforms.includes(c.platform))
      .map((c) => c.connection_id);
    const hasExtras =
      (result.slides?.length ?? 0) > 0 || (result.manual_steps?.length ?? 0) > 0;
    storeAppliedTemplate(
      {
        content: result.content,
        firstComment: result.first_comment,
        connectionIds,
        extras: hasExtras
          ? {
              templateName: template.name,
              slides: result.slides,
              manualSteps: result.manual_steps,
            }
          : null,
      },
      Date.now()
    );
    router.push('/publish');
  }

  async function generate(mode: 'ai' | 'scaffold') {
    if (!template || generating) return;
    setSlotError(null);

    const missing = template.slots.find(
      (slot) => isEffectivelyRequired(slot) && !slotValues[slot.key]?.trim()
    );
    if (missing) {
      setSlotError({
        key: missing.key,
        message: fill(dict.missing_slot_error, { question: missing.question }),
      });
      const element = slotRefs.current[missing.key];
      element?.focus();
      element?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      return;
    }

    const slots: Record<string, string> = {};
    for (const [key, value] of Object.entries(slotValues)) {
      if (value.trim()) slots[key] = value.trim();
    }

    setGenerating(mode);
    try {
      const response = await fetchApi<TemplateDraftResponse>('/v1/templates/draft', {
        method: 'POST',
        body: JSON.stringify({
          template_id: template.id,
          slots,
          target_platforms: targetPlatformsFor(template, activePlatforms),
          mode,
        }),
      });
      if (mode === 'scaffold') {
        // Deterministic scaffold: no surprise to preview — straight handoff.
        applyDraft(response.draft);
      } else {
        setDraft(response.draft);
      }
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setGenerating(null);
    }
  }

  function switchLocale(next: AppLocale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  // Rendering ----------------------------------------------------------------
  const stepTitle = showPreview
    ? dict.step4_preview_title
    : [dict.step1_title, dict.step2_title, dict.step3_title, dict.step4_fill_title][state.step - 1];

  const formatLabels: Record<PostTemplateSummary['format'], string> = {
    text: dict.format_text,
    thread: dict.format_thread,
    carousel_pdf: dict.format_carousel_pdf,
    image_text: dict.format_image_text,
    poll: dict.format_poll,
  };

  function ctaLabel(t: PostTemplateSummary): string {
    const wouldCharge =
      aiEnabled &&
      contextAvailable &&
      t.slots.some((s) => s.kind === 'angle') &&
      !(cachedIds?.has(t.id) ?? false);
    return wouldCharge ? dict.cta_fill_with_credit : dict.cta_fill_free;
  }

  const effortLabel: Record<'niedrig' | 'mittel' | 'hoch', string> = {
    niedrig: dict.effort_low,
    mittel: dict.effort_medium,
    hoch: dict.effort_high,
  };

  const hasErfahrungSlot = template?.slots.some((s) => s.kind === 'erfahrung') ?? false;

  const detailLabelClass = 'text-xs font-semibold uppercase tracking-wide text-gray-500';

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {(state.step > 1 || showPreview) && (
            <Button type="button" variant="ghost" size="sm" onClick={goBack}>
              ‹ {dict.back}
            </Button>
          )}
          <p className="text-xs font-medium text-gray-500">
            {fill(dict.step_of, { current: state.step, total: 4 })}
            {state.anlassAutoResolved && state.step >= 3 && ` · ${dict.auto_skipped}`}
          </p>
        </div>
        <div
          role="group"
          aria-label={dict.language_label}
          className="flex items-center gap-0.5 rounded-md p-0.5 ring-1 ring-inset ring-gray-200"
        >
          {APP_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={code === locale}
              onClick={() => switchLocale(code)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                code === locale
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {fill(dict.step_of, { current: state.step, total: 4 })} — {stepTitle}
      </p>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={contentKey}
          {...stepTransition(reduced)}
          onAnimationComplete={() => {
            // Focus the H1 of the ENTERING step only — the exiting instance
            // holds a stale contentKey and skips this.
            if (pendingFocusRef.current && contentKey === currentKeyRef.current) {
              pendingFocusRef.current = false;
              h1Ref.current?.focus();
            }
          }}
          className="flex flex-col gap-4"
        >
          <div>
            <h1 ref={h1Ref} tabIndex={-1} className="text-lg font-semibold text-gray-900 outline-none">
              {stepTitle}
            </h1>
            {!showPreview && state.step === 1 && (
              <p className="mt-1 text-sm text-gray-500">{dict.step1_subtitle}</p>
            )}
            {!showPreview && state.step === 2 && (
              <p className="mt-1 text-sm text-gray-500">{dict.step2_subtitle}</p>
            )}
            {!showPreview && state.step === 3 && (
              <p className="mt-1 text-sm text-gray-500">{dict.step3_subtitle}</p>
            )}
            {!showPreview && state.step === 4 && template && (
              <p className="mt-1 text-sm text-gray-500">
                {template.name} — {template.description}
              </p>
            )}
          </div>

          {/* Step 1: Ziel */}
          {!showPreview && state.step === 1 && (
            <div className="flex flex-col gap-3">
              {localizedIntentInfo(locale).filter((info) => templatesFor(templates, info.key).length > 0).map(
                (info) => (
                  <ChoiceCard
                    key={info.key}
                    title={info.label}
                    subtitle={info.satz}
                    expanded={expandedChoice === info.key}
                    onToggle={() =>
                      setExpandedChoice((current) => (current === info.key ? null : info.key))
                    }
                  >
                    <ul className="flex flex-col gap-1.5 text-sm text-gray-700">
                      {info.bullets.map((bullet) => (
                        <li key={bullet} className="flex gap-2">
                          <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-600" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2.5 text-xs text-gray-500">
                      <span className="font-medium">{dict.when_to_pick}</span> {info.wann}
                    </p>
                    <Button type="button" className="mt-3" onClick={() => chooseGoal(info.key)}>
                      {dict.continue_}
                    </Button>
                  </ChoiceCard>
                )
              )}
            </div>
          )}

          {/* Step 2: Anlass */}
          {!showPreview && state.step === 2 && state.goal && (
            <div className="flex flex-col gap-3">
              {localizedAnlaesseForGoal(templates, state.goal, locale).map((anlass) => (
                <ChoiceCard
                  key={anlass.key}
                  title={anlass.label}
                  subtitle={anlass.beschreibung}
                  expanded={expandedChoice === anlass.key}
                  onToggle={() =>
                    setExpandedChoice((current) => (current === anlass.key ? null : anlass.key))
                  }
                >
                  <p className="text-sm text-gray-700">
                    {dict.example_prefix} {anlass.beispiel}
                  </p>
                  <Button type="button" className="mt-3" onClick={() => chooseAnlass(anlass.key)}>
                    {dict.continue_}
                  </Button>
                </ChoiceCard>
              ))}
            </div>
          )}

          {/* Step 3: Vorlage (Strategie-Panel — user feedback #6) */}
          {!showPreview && state.step === 3 && state.goal && state.anlassKey && (
            <div className="flex flex-col gap-3">
              {templatesFor(templates, state.goal, state.anlassKey).map((t) => (
                <ChoiceCard
                  key={t.id}
                  title={t.name}
                  subtitle={t.description}
                  meta={<Badge tone="gray">{formatLabels[t.format]}</Badge>}
                  expanded={expandedChoice === t.id}
                  onToggle={() => setExpandedChoice((current) => (current === t.id ? null : t.id))}
                >
                  <p className="text-sm font-medium text-gray-900">{t.strategy.ziel}</p>

                  <div className="mt-3">
                    <p className={detailLabelClass}>{dict.why_it_works}</p>
                    <ul className="mt-1.5 flex flex-col gap-1.5 text-sm text-gray-700">
                      {t.strategy.warum.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary-600" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-3">
                    <p className={detailLabelClass}>{dict.benchmark_label}</p>
                    <ul className="mt-1.5 flex flex-col gap-1 text-sm text-gray-700">
                      {t.strategy.benchmarks.map((benchmark) => (
                        <li key={benchmark.metrik}>
                          {benchmark.metrik}: <span className="font-medium">{benchmark.wert}</span>{' '}
                          <span className="text-xs text-gray-400">({benchmark.quelle})</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-gray-400">{dict.benchmark_disclaimer}</p>
                  </div>

                  <p className="mt-3 text-sm text-gray-700">
                    <span className="font-medium">{dict.effort_label}:</span>{' '}
                    {effortLabel[t.strategy.aufwand]}
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span className="font-medium">{dict.frequency_label}:</span> {t.strategy.frequenz}
                  </p>

                  {t.strategy.voraussetzungen && t.strategy.voraussetzungen.length > 0 && (
                    <div className="mt-3">
                      <p className={detailLabelClass}>{dict.prerequisites_label}</p>
                      <ul className="mt-1 list-disc pl-4 text-sm text-gray-700">
                        {t.strategy.voraussetzungen.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-1.5">
                    {t.recommended_platforms.map((platform) => (
                      <span
                        key={platform}
                        title={PLATFORM_META[platform].label}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                        style={{ backgroundColor: PLATFORM_META[platform].color }}
                      >
                        {PLATFORM_META[platform].initial}
                      </span>
                    ))}
                    {t.manual_steps && t.manual_steps.length > 0 && (
                      <Badge tone="amber">{dict.preview_manual_steps}</Badge>
                    )}
                  </div>

                  <Button type="button" className="mt-4 w-full" onClick={() => chooseTemplate(t.id)}>
                    {ctaLabel(t)}
                  </Button>
                </ChoiceCard>
              ))}
            </div>
          )}

          {/* Step 4: Ausfüllen */}
          {!showPreview && state.step === 4 && template && (
            <div className="flex flex-col gap-4">
              {hasErfahrungSlot && (
                <p className="rounded-md bg-primary-50 px-3 py-2 text-sm text-primary-700">
                  {dict.experience_hint}
                </p>
              )}

              {prefillEligible && prefillStatus === 'loading' && (
                <p className="flex items-center gap-2 text-sm text-gray-500">
                  <Spinner size="sm" /> {dict.prefill_loading}
                </p>
              )}
              {prefillEligible && prefillStatus === 'error' && (
                <p className="text-sm text-gray-500">
                  {dict.prefill_error} {dict.prefill_continue_without}
                </p>
              )}
              {prefillEligible && prefillStatus === 'loading' && (
                <p className="text-xs text-gray-400">{dict.cost_line}</p>
              )}
              {!aiEnabled && <p className="text-xs text-gray-400">{dict.cost_line_no_credits}</p>}

              {showMicNotice && (
                <div className="flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <p className="text-xs text-gray-600">{dict.mic_privacy_notice}</p>
                  <Button type="button" variant="secondary" size="sm" className="self-start" onClick={dismissMicNotice}>
                    {dict.mic_privacy_dismiss}
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-4">
                {template.slots.map((slot) => (
                  <SlotField
                    key={slot.key}
                    slot={slot}
                    value={slotValues[slot.key] ?? ''}
                    required={isEffectivelyRequired(slot)}
                    onChange={(value) => handleSlotChange(slot.key, value)}
                    aiSuggested={aiKeys.has(slot.key)}
                    error={slotError?.key === slot.key ? slotError.message : undefined}
                    dict={dict}
                    mic={{
                      supported: speech.supported,
                      active: speech.activeKey === slot.key,
                      blocked: speech.blocked,
                      noSpeechHint: noSpeechKey === slot.key,
                      onToggle: () => handleMicToggle(slot),
                    }}
                    textareaRef={(element) => {
                      slotRefs.current[slot.key] = element;
                    }}
                  />
                ))}
              </div>

              {prefillEligible && (prefillStatus === 'done' || prefillStatus === 'error') && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => void regenerateSuggestions()}
                >
                  {dict.regenerate_suggestions}
                </Button>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  loading={generating === 'scaffold'}
                  disabled={generating !== null}
                  onClick={() => void generate('scaffold')}
                >
                  {dict.scaffold_only}
                </Button>
                <Button
                  type="button"
                  loading={generating === 'ai'}
                  disabled={generating !== null || !aiEnabled}
                  onClick={() => void generate('ai')}
                >
                  {generating === 'ai' ? dict.generating_draft : dict.generate_draft}
                </Button>
              </div>
              {!aiEnabled && (
                <div className="text-right text-xs text-amber-700" role="status">
                  <p>{aiFeature.hint ?? dict.ai_disabled_reason}</p>
                  {aiFeature.missing && (
                    <p className="mt-1 font-mono">{aiFeature.missing.join(' · ')}</p>
                  )}
                </div>
              )}
              <p className="text-right text-xs text-gray-500">
                {Number.isFinite(creditsLimit)
                  ? `${Math.max(0, creditsLimit - creditsUsed)} / ${creditsLimit} AI credits remaining this month`
                  : 'Unlimited AI credits'}
              </p>
            </div>
          )}

          {/* Step 4b: Entwurfs-Vorschau (V1 — der Payoff-Moment vor dem Composer) */}
          {showPreview && draft && template && (
            <div className="flex flex-col gap-4">
              <div className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm">
                {draft.content}
              </div>

              {draft.first_comment && (
                <div>
                  <p className={detailLabelClass}>{dict.preview_first_comment}</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {draft.first_comment}
                  </p>
                </div>
              )}

              {draft.slides && draft.slides.length > 0 && (
                <div>
                  <p className={detailLabelClass}>{dict.preview_slides}</p>
                  <ol className="mt-1 flex flex-col gap-1.5">
                    {draft.slides.map((slide, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="mt-0.5 shrink-0 text-xs font-semibold text-gray-400">
                          {index + 1}.
                        </span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap">{slide}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {draft.manual_steps && draft.manual_steps.length > 0 && (
                <div>
                  <p className={detailLabelClass}>{dict.preview_manual_steps}</p>
                  <ul className="mt-1 list-disc pl-4 text-sm text-gray-700">
                    {draft.manual_steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-sm text-gray-500">
                <span className="font-medium">{dict.preview_platforms}:</span>{' '}
                {draft.recommended_platforms.map((p) => PLATFORM_META[p].label).join(', ')}
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  {dict.back_to_edit}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  loading={generating === 'ai'}
                  disabled={generating !== null}
                  onClick={() => void generate('ai')}
                >
                  {dict.regenerate_draft}
                </Button>
                <Button type="button" onClick={() => applyDraft(draft)}>
                  {dict.apply_to_composer}
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
