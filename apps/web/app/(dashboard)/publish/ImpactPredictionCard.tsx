'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AppLocale, PlatformType } from '@prolora/shared';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from '@/app/components/Button';
import { Card } from '@/app/components/Card';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { ConnectionWithLimit } from '@/lib/connections/list-connections';
import { getDict, fill } from '@/lib/i18n';
import {
  runDeterministicChecks,
  type DeterministicResult,
} from '@/lib/scoring/deterministic';
import type {
  ImpactFramework,
  ImpactTrafficLight,
} from '@/lib/scoring/score-service';
import { FoldPreview } from './FoldPreview';
import { moveLinksToFirstComment, replaceFirstLine } from './impact-card-logic';

interface ImpactApiResponse {
  virality_score: number;
  traffic_light: ImpactTrafficLight;
  score_breakdown: {
    hook: number;
    structure: number;
    formatting: number;
    platform_hygiene: number;
  };
  detected_framework: ImpactFramework;
  improvements: string[];
  hook_rewrite?: string;
  deterministic: DeterministicResult;
  credits_used: number;
  expectation?: { low: number; median: number; high: number; n: number };
}

interface VariantResult {
  label: string;
  hook: string | null;
  content: string;
  result: ImpactApiResponse;
}

export function ImpactPredictionCard({
  connections,
  selected,
  content,
  setContent,
  firstComment,
  setFirstComment,
  setShowFirstComment,
  locale,
}: {
  connections: ConnectionWithLimit[];
  selected: Set<string>;
  content: string;
  setContent: (content: string) => void;
  firstComment: string;
  setFirstComment: (comment: string) => void;
  setShowFirstComment: (show: boolean) => void;
  locale: AppLocale;
}) {
  const dict = getDict(locale);
  const reducedMotion = useReducedMotion();
  const platforms = useMemo(
    () =>
      [...new Set(
        connections
          .filter((connection) => selected.has(connection.connection_id))
          .map((connection) => connection.platform)
      )],
    [connections, selected]
  );
  const [activePlatform, setActivePlatform] = useState<PlatformType | null>(platforms[0] ?? null);
  const [result, setResult] = useState<ImpactApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedImprovements, setCompletedImprovements] = useState<Set<number>>(new Set());
  const [showVariants, setShowVariants] = useState(false);
  const [variantHooks, setVariantHooks] = useState(['', '']);
  const [variantResults, setVariantResults] = useState<VariantResult[]>([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const activeConnectionId = useMemo(
    () =>
      connections.find(
        (connection) =>
          selected.has(connection.connection_id) && connection.platform === activePlatform
      )?.connection_id,
    [activePlatform, connections, selected]
  );

  useEffect(() => {
    if (!activePlatform || !platforms.includes(activePlatform)) {
      setActivePlatform(platforms[0] ?? null);
    }
  }, [activePlatform, platforms]);

  useEffect(() => {
    setResult(null);
    setError(null);
    setCompletedImprovements(new Set());
    setVariantResults([]);
  }, [content, firstComment, activePlatform]);

  const deterministic = useMemo(
    () =>
      activePlatform
        ? runDeterministicChecks(content, activePlatform, { firstComment })
        : null,
    [activePlatform, content, firstComment]
  );

  async function requestScore(postContent: string): Promise<ImpactApiResponse> {
    if (!activePlatform) throw new Error(dict.impact_no_platform);
    return fetchApi<ImpactApiResponse>('/v1/posts/score', {
      method: 'POST',
      body: JSON.stringify({
        content: postContent,
        platform: activePlatform,
        first_comment: firstComment || undefined,
        connection_id: activeConnectionId,
      }),
    });
  }

  async function checkImpact() {
    setLoading(true);
    setError(null);
    try {
      setResult(await requestScore(content));
    } catch (scoreError) {
      setError(errorMessage(scoreError));
    } finally {
      setLoading(false);
    }
  }

  async function compareVariants() {
    const alternatives = variantHooks.map((hook) => hook.trim()).filter(Boolean).slice(0, 2);
    const candidates = [
      { label: dict.impact_variant_original, hook: null, candidateContent: content },
      ...alternatives.map((hook, index) => ({
        label: `${dict.impact_hook} ${index + 1}`,
        hook,
        candidateContent: replaceFirstLine(content, hook),
      })),
    ];

    setVariantLoading(true);
    setVariantResults([]);
    setError(null);
    const completed: VariantResult[] = [];
    try {
      for (const candidate of candidates) {
        const score = await requestScore(candidate.candidateContent);
        completed.push({
          label: candidate.label,
          hook: candidate.hook,
          content: candidate.candidateContent,
          result: score,
        });
        setVariantResults([...completed]);
      }
      setResult(completed[0]?.result ?? null);
    } catch (scoreError) {
      setError(errorMessage(scoreError));
    } finally {
      setVariantLoading(false);
    }
  }

  function moveLinks() {
    if (!deterministic || deterministic.body_links.length === 0) return;
    const moved = moveLinksToFirstComment({
      content,
      bodyLinks: deterministic.body_links,
      firstComment,
      contextSentence: dict.impact_link_context,
    });
    setContent(moved.content);
    setFirstComment(moved.firstComment);
    setShowFirstComment(true);
  }

  const scoreColor = result ? trafficColor(result.traffic_light) : '#d1d5db';
  const statusMessage = result
    ? result.traffic_light === 'green'
      ? dict.impact_green_message
      : result.traffic_light === 'yellow'
        ? dict.impact_yellow_message
        : dict.impact_red_message
    : null;
  const variantCount = 1 + variantHooks.filter((hook) => hook.trim()).length;

  return (
    <Card title={dict.impact_title} description={dict.impact_description}>
      <div className="space-y-4">
        {platforms.length > 1 && (
          <div className="flex flex-wrap gap-2" aria-label="Scoring platform">
            {platforms.map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => setActivePlatform(platform)}
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
                  activePlatform === platform
                    ? 'bg-primary-100 text-primary-800 ring-1 ring-primary-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {platform}
              </button>
            ))}
          </div>
        )}

        {!activePlatform ? (
          <p className="text-sm text-gray-500">{dict.impact_no_platform}</p>
        ) : !content.trim() ? (
          <p className="text-sm text-gray-500">{dict.impact_empty}</p>
        ) : (
          <>
            {deterministic && (
              <div className="grid grid-cols-2 gap-3">
                <LiveMetric label={dict.impact_formatting} value={deterministic.formatting_score} />
                <LiveMetric label={dict.impact_hygiene} value={deterministic.platform_hygiene_score} />
              </div>
            )}

            {deterministic && deterministic.body_links.length > 0 && (
              <button
                type="button"
                onClick={moveLinks}
                className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-sm font-semibold text-amber-800 hover:bg-amber-100"
              >
                ↳ {dict.impact_move_link}
              </button>
            )}

            <FoldPreview content={content} platform={activePlatform} locale={locale} />

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void checkImpact()} loading={loading}>
                {loading ? dict.impact_checking : dict.impact_check}
              </Button>
              <button
                type="button"
                onClick={() => setShowVariants((visible) => !visible)}
                className="text-sm font-semibold text-primary-700 hover:text-primary-800"
              >
                {dict.impact_variants_button}
              </button>
            </div>
            <p className="text-xs text-gray-500">{dict.impact_credit_hint}</p>
            {activePlatform === 'linkedin' && (
              <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                {dict.impact_linkedin_calibration}
              </p>
            )}
          </>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2" role="alert">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={() => void checkImpact()}
              className="shrink-0 text-xs font-semibold text-red-800 underline"
            >
              {dict.impact_retry}
            </button>
          </div>
        )}

        {result && (
          <div className="space-y-4 border-t border-gray-200 pt-4">
            <div className="flex items-center gap-4">
              <motion.div
                key={`${result.virality_score}-${result.traffic_light}`}
                initial={reducedMotion ? false : { scale: 0.88, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="grid h-20 w-20 shrink-0 place-items-center rounded-full p-1"
                style={{
                  background: `conic-gradient(${scoreColor} ${result.virality_score}%, #e5e7eb 0)`,
                }}
                aria-label={`Impact score ${result.virality_score} of 100`}
              >
                <div className="grid h-full w-full place-items-center rounded-full bg-white text-xl font-bold text-gray-900">
                  {result.virality_score}
                </div>
              </motion.div>
              <div>
                <p className="text-sm font-semibold" style={{ color: scoreColor }}>
                  {result.traffic_light === 'green'
                    ? dict.impact_green
                    : result.traffic_light === 'yellow'
                      ? dict.impact_yellow
                      : dict.impact_red}
                </p>
                <p className="mt-1 text-sm text-gray-700">{statusMessage}</p>
              </div>
            </div>

            <div className="space-y-2">
              <ScoreBar label={dict.impact_hook} value={result.score_breakdown.hook} max={30} />
              <ScoreBar label={dict.impact_structure} value={result.score_breakdown.structure} max={30} />
              <ScoreBar label={dict.impact_formatting} value={result.score_breakdown.formatting} max={20} />
              <ScoreBar label={dict.impact_hygiene} value={result.score_breakdown.platform_hygiene} max={20} />
            </div>

            {result.expectation && (
              <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {fill(dict.impact_expectation, {
                  low: result.expectation.low,
                  high: result.expectation.high,
                  n: result.expectation.n,
                })}
              </p>
            )}

            {result.improvements.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {dict.impact_improvements}
                </h3>
                <ul className="mt-2 space-y-2">
                  {result.improvements.map((improvement, index) => (
                    <li key={`${improvement}-${index}`}>
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={completedImprovements.has(index)}
                          onChange={() =>
                            setCompletedImprovements((current) => {
                              const next = new Set(current);
                              if (next.has(index)) next.delete(index);
                              else next.add(index);
                              return next;
                            })
                          }
                          className="mt-0.5 h-4 w-4 rounded text-primary-600"
                        />
                        <span className={completedImprovements.has(index) ? 'text-gray-400 line-through' : ''}>
                          {improvement}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.hook_rewrite && (
              <div className="rounded-md bg-primary-50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
                  {dict.impact_hook_rewrite}
                </p>
                <p className="mt-1 text-sm text-gray-900">{result.hook_rewrite}</p>
                <button
                  type="button"
                  onClick={() => setContent(replaceFirstLine(content, result.hook_rewrite!))}
                  className="mt-2 text-xs font-semibold text-primary-800 underline"
                >
                  {dict.impact_apply}
                </button>
              </div>
            )}
          </div>
        )}

        {showVariants && activePlatform && content.trim() && (
          <div className="space-y-3 border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-900">{dict.impact_variants_title}</h3>
            {variantHooks.map((hook, index) => (
              <input
                key={index}
                value={hook}
                onChange={(event) =>
                  setVariantHooks((current) =>
                    current.map((value, currentIndex) => currentIndex === index ? event.target.value : value)
                  )
                }
                placeholder={`${dict.impact_variant_placeholder} ${index + 1}`}
                maxLength={300}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" loading={variantLoading} onClick={() => void compareVariants()}>
                {dict.impact_variant_compare}
              </Button>
              <span className="text-xs text-gray-500">
                {fill(dict.impact_variant_cost, { count: variantCount })}
              </span>
            </div>

            {variantResults.length > 0 && (
              <div className="overflow-hidden rounded-md border border-gray-200">
                {variantResults.map((variant) => (
                  <div key={variant.label} className="flex items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-500">{variant.label}</p>
                      <p className="truncate text-sm text-gray-900">
                        {variant.hook ?? content.split('\n')[0]}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-gray-900">
                      {dict.impact_variant_score}: {variant.result.virality_score}
                    </span>
                    {variant.hook && (
                      <button
                        type="button"
                        onClick={() => setContent(variant.content)}
                        className="text-xs font-semibold text-primary-700 underline"
                      >
                        {dict.impact_variant_use}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function LiveMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-gray-900">{value}/20</p>
    </div>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[5rem_1fr_3rem] items-center gap-2 text-xs">
      <span className="text-gray-600">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-primary-500" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="text-right font-semibold text-gray-700">{value}/{max}</span>
    </div>
  );
}

function trafficColor(light: ImpactTrafficLight): string {
  if (light === 'green') return '#16a34a';
  if (light === 'yellow') return '#d97706';
  return '#dc2626';
}
