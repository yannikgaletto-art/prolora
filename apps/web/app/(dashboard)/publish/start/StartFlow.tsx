'use client';

// Guided product-to-post flow (GOAL-RUN9 §8). Goal chips → deterministic angle
// cards (0 credits) → optional gear drawer → "3 Entwürfe generieren" (1 credit)
// → draft cards → composer handoff (same mechanism as the template wizard).
// Nothing here publishes anything (D4).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_CONCEPT_SETTINGS,
  type AngleSuggestion,
  type AppLocale,
  type ConceptResponse,
  type ConceptSettings,
  type ContentGoal,
  type PostConcept,
} from '@prolora/shared';
import Link from 'next/link';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { Textarea } from '@/app/components/Input';
import { fetchApi, errorMessage } from '@/app/lib/api';
import { storeAppliedTemplate } from '../handoff';
import { useSpeechInput } from '../templates/useSpeechInput';
import { getProductCopy } from '@/lib/i18n/product';
import { GenerationPreflight, type PreflightLanguage, type PreflightMention } from '../writer/GenerationPreflight';

const GOALS: ContentGoal[] = [
  'authority',
  'productEducation',
  'buildInPublic',
  'personalStory',
  'community',
  'conversion',
];

interface AngleDto extends AngleSuggestion {
  reference: {
    id: string;
    hook: string;
    reusable_pattern: string;
    verified: boolean;
    engagement: Record<string, number | null> | null;
  } | null;
}

interface AnglesResponse {
  has_profile: boolean;
  angles: AngleDto[];
}

interface Props {
  locale: AppLocale;
  workspaceName: string;
  productDescription: string | null;
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm text-gray-700">
        <span>{label}</span>
        <span className="font-mono text-xs text-gray-500">{value}/5</span>
      </span>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-primary-600"
      />
    </label>
  );
}

export function StartFlow({ locale, workspaceName, productDescription }: Props) {
  const copy = getProductCopy(locale);
  const router = useRouter();
  const speech = useSpeechInput(locale);

  const [goal, setGoal] = useState<ContentGoal | null>(null);
  const [angles, setAngles] = useState<AngleDto[] | null>(null);
  const [hasProfile, setHasProfile] = useState(Boolean(productDescription));
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [selectedAngle, setSelectedAngle] = useState<AngleDto | null>(null);
  const [ownIdea, setOwnIdea] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<ConceptSettings>(DEFAULT_CONCEPT_SETTINGS);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [concepts, setConcepts] = useState<PostConcept[] | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<string[]>([]);
  const [outputLanguage, setOutputLanguage] = useState<PreflightLanguage>(locale === 'de' ? 'de' : 'en');
  const [mentionMode, setMentionMode] = useState<PreflightMention>('adaptive');
  const draftsRef = useRef<HTMLDivElement | null>(null);

  const loadAngles = useCallback(
    async (nextGoal: ContentGoal) => {
      setGoal(nextGoal);
      setSelectedAngle(null);
      setConcepts(null);
      setFollowUps([]);
      setAnglesLoading(true);
      try {
        const result = await fetchApi<AnglesResponse>(`/v1/concepts/angles?goal=${nextGoal}`);
        setAngles(result.angles);
        setHasProfile(result.has_profile);
      } catch {
        setAngles([]);
      } finally {
        setAnglesLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (concepts && draftsRef.current) {
      draftsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [concepts]);

  async function generate(withFollowUpAnswers: boolean) {
    if (!goal) return;
    setGenerating(true);
    setGenerateError('');
    try {
      const result = await fetchApi<ConceptResponse>('/v1/concepts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content_goal: goal,
          angle: selectedAngle ? `${selectedAngle.title} — ${selectedAngle.angle}` : undefined,
          user_idea: ownIdea.trim() || undefined,
          follow_up_answers: withFollowUpAnswers
            ? followUpAnswers.map((answer) => answer.trim()).filter(Boolean)
            : undefined,
          settings,
          output_language: outputLanguage,
          product_mention_mode: mentionMode,
        }),
      });
      setConcepts(result.concepts);
      setFollowUps(result.follow_up_questions ?? []);
      setFollowUpAnswers((result.follow_up_questions ?? []).map(() => ''));
    } catch (error) {
      setGenerateError(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  }

  function openDraft(concept: PostConcept) {
    storeAppliedTemplate(
      {
        content: concept.canonical_content,
        connectionIds: [],
        extras: { templateName: concept.title || copy.lens_labels[concept.lens] },
      },
      Date.now()
    );
    router.push('/publish');
  }

  const canGenerate = Boolean(goal) && (Boolean(selectedAngle) || ownIdea.trim().length > 0);

  return (
    <div className="flex flex-col gap-4">
      <GenerationPreflight language={outputLanguage} mention={mentionMode} allowBoth={false} locale={locale} disabled={generating} onLanguageChange={setOutputLanguage} onMentionChange={setMentionMode} />
      <Card title={workspaceName} description={productDescription ?? copy.start_no_profile}>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/product"
            className="inline-flex items-center rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-300"
          >
            {hasProfile ? copy.start_edit_profile : copy.start_setup_cta}
          </Link>
        </div>
      </Card>

      <Card title={copy.goal_label}>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => void loadAngles(g)}
              title={copy.goals[g].hint}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                goal === g
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {copy.goals[g].label}
            </button>
          ))}
        </div>
      </Card>

      {goal && (
        <Card title={copy.recommends_title}>
          {anglesLoading ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-40 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : angles && angles.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {angles.map((angle) => {
                const active = selectedAngle?.lens === angle.lens;
                return (
                  <button
                    key={angle.lens}
                    type="button"
                    onClick={() => setSelectedAngle(active ? null : angle)}
                    className={`flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors ${
                      active
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
                      {copy.lens_labels[angle.lens]} · {angle.structure_label}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{angle.title}</span>
                    <span className="text-sm text-gray-600">{angle.angle}</span>
                    <span className="text-xs text-gray-500">{angle.why_this_fits}</span>
                    {angle.reference && (
                      <span className="text-xs text-gray-400">
                        {copy.based_on}: „{angle.reference.hook}“
                        {!angle.reference.verified && ` — ${copy.unverified_badge}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{copy.recommends_empty}</p>
          )}

          <div className="mt-4">
            <Textarea
              label={copy.own_idea}
              rows={3}
              value={ownIdea}
              onChange={(e) => setOwnIdea(e.target.value)}
              placeholder={copy.own_idea_placeholder}
              maxLength={4000}
            />
            {speech.supported && !speech.blocked && (
              <button
                type="button"
                onClick={() => {
                  if (speech.activeKey === 'own-idea') {
                    speech.stop();
                  } else {
                    speech.start('own-idea', (text) =>
                      setOwnIdea((prev) => (prev ? `${prev} ${text}` : text))
                    );
                  }
                }}
                className={`mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  speech.activeKey === 'own-idea'
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300'
                }`}
              >
                🎙 {speech.activeKey === 'own-idea' ? copy.dictate_stop : copy.dictate}
              </button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void generate(false)} disabled={!canGenerate || generating}>
              {generating ? copy.generating : copy.generate_cta}
            </Button>
            <button
              type="button"
              onClick={() => setShowSettings((prev) => !prev)}
              aria-expanded={showSettings}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-300"
            >
              ⚙ {copy.settings_open}
            </button>
            <span className="text-xs text-gray-400">{copy.credits_note}</span>
          </div>
          {generating && <p className="mt-2 text-sm text-gray-500">{copy.generating_hint}</p>}
          {generateError && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {generateError || copy.generate_error}
            </p>
          )}

          {showSettings && (
            <div className="mt-4 grid gap-4 rounded-lg border border-gray-200 p-4 sm:grid-cols-2">
              <Slider
                label={copy.setting_value_density}
                value={settings.valueDensity}
                onChange={(v) =>
                  setSettings((s) => ({ ...s, valueDensity: v as ConceptSettings['valueDensity'] }))
                }
              />
              <Slider
                label={copy.setting_community}
                value={settings.communityCommitment}
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    communityCommitment: v as ConceptSettings['communityCommitment'],
                  }))
                }
              />
              <Slider
                label={copy.setting_vulnerability}
                value={settings.vulnerability}
                onChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    vulnerability: v as ConceptSettings['vulnerability'],
                  }))
                }
              />
              <label className="block">
                <span className="text-sm text-gray-700">{copy.setting_length}</span>
                <select
                  value={settings.length}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, length: e.target.value as ConceptSettings['length'] }))
                  }
                  className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm"
                >
                  <option value="short">{copy.setting_length_options.short}</option>
                  <option value="medium">{copy.setting_length_options.medium}</option>
                  <option value="long">{copy.setting_length_options.long}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-gray-700">{copy.setting_tone}</span>
                <select
                  value={settings.tone}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, tone: e.target.value as ConceptSettings['tone'] }))
                  }
                  className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm"
                >
                  <option value="reflective">{copy.setting_tone_options.reflective}</option>
                  <option value="direct">{copy.setting_tone_options.direct}</option>
                  <option value="provocative">{copy.setting_tone_options.provocative}</option>
                  <option value="educational">{copy.setting_tone_options.educational}</option>
                </select>
              </label>
              <div className="space-y-2 sm:col-span-2">
                {(
                  [
                    ['includeData', copy.setting_include_data],
                    ['includeFramework', copy.setting_include_framework],
                    ['includeCTA', copy.setting_include_cta],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={settings[key]}
                      onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.checked }))}
                      className="accent-primary-600"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {followUps.length > 0 && (
        <Card title={copy.follow_up_title} description={copy.follow_up_hint}>
          <div className="space-y-3">
            {followUps.map((question, index) => (
              <Textarea
                key={question}
                label={question}
                rows={2}
                value={followUpAnswers[index] ?? ''}
                onChange={(e) =>
                  setFollowUpAnswers((prev) => {
                    const next = [...prev];
                    next[index] = e.target.value;
                    return next;
                  })
                }
                maxLength={2000}
              />
            ))}
            <Button
              onClick={() => void generate(true)}
              disabled={generating || followUpAnswers.every((answer) => !answer.trim())}
            >
              {generating ? copy.generating : copy.follow_up_regenerate}
            </Button>
          </div>
        </Card>
      )}

      {concepts && (
        <div ref={draftsRef}>
          <Card title={copy.drafts_title}>
            <div className="grid gap-3 lg:grid-cols-3">
              {concepts.map((concept) => (
                <div
                  key={concept.lens}
                  className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4"
                >
                  <span className="self-start rounded-full bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
                    {copy.lens_labels[concept.lens]} · {concept.structure_label}
                  </span>
                  <p className="text-sm font-semibold text-gray-900">{concept.title}</p>
                  <p className="line-clamp-6 whitespace-pre-wrap text-sm text-gray-700">
                    {concept.canonical_content}
                  </p>
                  <p className="text-xs text-gray-500">{concept.rationale}</p>
                  <div className="mt-auto pt-2">
                    <Button onClick={() => openDraft(concept)}>{copy.open_draft}</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
