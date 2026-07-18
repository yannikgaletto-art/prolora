// GOAL-RUN8 T1.3: the model judges only hook and structure; deterministic
// points stay authoritative, bounded and explainable on the server.
import { CREDIT_COSTS, type PlatformType, type StylePreset } from '@prolora/shared';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { PLATFORM_NOTES, STYLE_PRESET_RULES } from '@/lib/templates/render-prompt';
import { assertCreditQuota, recordCreditUsage } from '@/lib/usage/credits';
import { DETERMINISTIC_VERSION, type DeterministicResult } from '@/lib/scoring/deterministic';
import { persistImpactPrediction } from '@/lib/scoring/prediction-store';
import { hashScoredContent } from '@/lib/scoring/content-hash';
import { expectationBand, type ExpectationBand } from '@/lib/scoring/baseline';
import { loadConnectionBaseline } from '@/lib/scoring/reconcile';

export const PROMPT_VERSION = 1;

const MAX_RETRIES = 1;
const MAX_MODEL_SCORE = 30;

export const IMPACT_THRESHOLDS = {
  green: 75,
  yellow: 50,
} as const;

export type ImpactFramework =
  | 'pia'
  | 'hormozi_contrast'
  | 'relatable_enemy'
  | 'evidence_story'
  | 'none';

export type ImpactTrafficLight = 'green' | 'yellow' | 'red';

export interface RawImpactScore {
  hook_score: number;
  structure_score: number;
  detected_framework: ImpactFramework;
  improvements: string[];
  hook_rewrite?: string;
}

export interface ImpactScoreResult {
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
}

export interface ScorePostInput {
  content: string;
  platform: PlatformType;
  firstComment?: string;
  language?: string;
  connectionId?: string;
  deterministic: DeterministicResult;
}

export interface ScorePostResponse extends ImpactScoreResult {
  deterministic: DeterministicResult;
  credits_used: number;
  expectation?: ExpectationBand;
}

export function normalizeImpactScore(
  raw: RawImpactScore,
  deterministic: DeterministicResult
): ImpactScoreResult {
  const hook = clampModelScore(raw.hook_score);
  const structure = clampModelScore(raw.structure_score);
  const breakdown = {
    hook,
    structure,
    formatting: deterministic.formatting_score,
    platform_hygiene: deterministic.platform_hygiene_score,
  };
  const viralityScore = Object.values(breakdown).reduce((sum, score) => sum + score, 0);
  const hookRewrite = raw.hook_rewrite?.trim();

  return {
    virality_score: viralityScore,
    traffic_light:
      viralityScore >= IMPACT_THRESHOLDS.green
        ? 'green'
        : viralityScore >= IMPACT_THRESHOLDS.yellow
          ? 'yellow'
          : 'red',
    score_breakdown: breakdown,
    detected_framework: raw.detected_framework,
    improvements: raw.improvements
      .filter((item) => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 3),
    ...(hookRewrite ? { hook_rewrite: hookRewrite } : {}),
  };
}

export async function scorePost(
  workspaceId: string,
  input: ScorePostInput
): Promise<ScorePostResponse> {
  await assertCreditQuota(workspaceId, CREDIT_COSTS.impact_score);

  const context = await getWorkspaceContext(workspaceId);
  const outputLanguage = input.language ?? context?.voice_language?.trim() ?? 'de';
  const systemPrompt = buildImpactSystemPrompt({
    platform: input.platform,
    language: outputLanguage,
    deterministic: input.deterministic,
    productDescription: context?.product_description ?? null,
    targetAudience: context?.target_audience ?? null,
    voiceTone: context?.voice_tone ?? null,
    creatorStyle: context?.creator_style ?? 'neutral',
  });

  const client = getAnthropicClient();
  let inputTokens = 0;
  let outputTokens = 0;
  let strictNote = '';
  let normalized: ImpactScoreResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Bewerte diesen Post-Entwurf:\n\n${input.content}${strictNote}`,
          },
        ],
        tools: [
          {
            name: 'score_post',
            description: 'Return the hook and structure rubric for one post draft',
            input_schema: {
              type: 'object' as const,
              properties: {
                hook_score: {
                  type: 'number',
                  description: '0-30 points for specificity, tension and stopping power of the opening',
                },
                structure_score: {
                  type: 'number',
                  description: '0-30 points for flow, payoff, evidence and actionable clarity',
                },
                detected_framework: {
                  type: 'string',
                  enum: ['pia', 'hormozi_contrast', 'relatable_enemy', 'evidence_story', 'none'],
                },
                improvements: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '2-3 concrete, actionable improvements in the workspace language',
                },
                hook_rewrite: {
                  type: 'string',
                  description: 'Optional stronger first sentence in the workspace language',
                },
              },
              required: ['hook_score', 'structure_score', 'detected_framework', 'improvements'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'score_post' },
      });
    } catch (error) {
      console.error('[impact] anthropic call failed:', error);
      throw new ApiError(502, 'Impact scoring is temporarily unavailable.', 'ai_unavailable');
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const toolBlock = response.content.find((block) => block.type === 'tool_use');
    const parsed = toolBlock?.type === 'tool_use' ? parseToolInput(toolBlock.input) : null;
    if (parsed) {
      normalized = normalizeImpactScore(parsed, input.deterministic);
      break;
    }
    strictNote =
      '\n\nDeine vorige Antwort war unvollständig. Nutze score_post und liefere endliche Zahlen, ein gültiges Framework und 2-3 konkrete Hinweise.';
  }

  if (!normalized) {
    throw new ApiError(502, 'Impact scoring returned no valid result.', 'ai_unavailable');
  }

  await persistImpactPrediction({
    workspaceId,
    platform: input.platform,
    contentHash: hashScoredContent(input.content),
    result: normalized,
    framework: normalized.detected_framework,
    promptVersion: PROMPT_VERSION,
    deterministicVersion: DETERMINISTIC_VERSION,
    model: AI_MODEL,
  });

  const usageError = await recordCreditUsage({
    workspaceId,
    action: 'impact_score',
    creditsUsed: CREDIT_COSTS.impact_score,
    metadata: {
      platform: input.platform,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: AI_MODEL,
      prompt_version: PROMPT_VERSION,
    },
  });
  if (usageError) {
    console.error('[impact] usage log failed:', usageError);
  }

  let expectation: ExpectationBand | null = null;
  if (input.connectionId) {
    try {
      expectation = expectationBand(await loadConnectionBaseline({
        workspaceId,
        connectionId: input.connectionId,
        platform: input.platform,
      }));
    } catch (error) {
      console.error('[impact] expectation lookup failed:', error);
    }
  }

  return {
    ...normalized,
    deterministic: input.deterministic,
    credits_used: CREDIT_COSTS.impact_score,
    ...(expectation ? { expectation } : {}),
  };
}

export function buildImpactSystemPrompt(input: {
  platform: PlatformType;
  language: string;
  deterministic: DeterministicResult;
  productDescription: string | null;
  targetAudience: string | null;
  voiceTone: string | null;
  creatorStyle: StylePreset;
}): string {
  const linkInstruction =
    input.deterministic.body_links.length > 0
      ? 'Der Body enthält einen Link. Mindestens eine Verbesserung muss konkret empfehlen, ihn in den ersten Kommentar zu verschieben.'
      : 'Der Body enthält keinen Link.';
  const preferredStyleInstruction =
    input.creatorStyle === 'neutral'
      ? null
      : [
          `Bewerte Hook und Struktur bevorzugt gegen dieses gewählte Muster: ${STYLE_PRESET_RULES[input.creatorStyle]}`,
          `Wenn der Text dem Muster widerspricht, muss mindestens eine konkrete ${input.creatorStyle === 'koe_pia' ? 'PIA-bezogene ' : ''}Verbesserung den Widerspruch beheben.`,
        ].join('\n');

  return [
    'Du bist der Prolora Impact-Coach für Social-Media-Entwürfe.',
    'Antworte ausschließlich über das Tool score_post.',
    `Schreibe Verbesserungen und Hook-Rewrite in der Sprache ${input.language}.`,
    `Workspace-Ton: ${input.voiceTone ?? 'casual'}.`,
    ...(input.productDescription ? [`Produktkontext: ${input.productDescription}`] : []),
    ...(input.targetAudience ? [`Zielgruppe: ${input.targetAudience}`] : []),
    '',
    'Bewerte NUR Hook (0-30) und Struktur (0-30). Formatierung und Plattform-Hygiene wurden deterministisch bewertet;',
    `wiederhole oder bewerte sie nicht erneut: Format ${input.deterministic.formatting_score}/20, Hygiene ${input.deterministic.platform_hygiene_score}/20.`,
    linkInstruction,
    ...(preferredStyleInstruction ? [preferredStyleInstruction] : []),
    '',
    'Bewertungsanker:',
    '- Hormozi-Kontrast: klare Kontrast-These, spezifischer Beleg, parallele Dreiersätze.',
    '- Welsh/Relatable Enemy: vertrauter Gegner, kurze Zuspitzung und Cliffhanger vor dem Fold.',
    '- Koe/PIA: Pain → Insight → Action mit nachvollziehbarem Übergang.',
    '- Abdaal/Evidence Story: Transformationsversprechen mit konkreter Evidenz statt bloßer Behauptung.',
    'Bewerte den Hook ausschließlich anhand der ersten 1-3 Zeilen; ein kurzer oder unfertiger Body darf den Hook-Score nicht senken.',
    'Hook-Bänder: 0-9 = generisch/ohne Spannung; 10-21 = klar, aber vertraut oder wenig spezifisch; 22-30 = expliziter Relatable Enemy oder scharfer Kontrast plus Spannung/Cliffhanger.',
    'Kalibrierungsanker: „The 9 to 5 is getting pummeled … And I love it. Why?“ erfüllt den Welsh-Relatable-Enemy-Anker und liegt beim Hook im Band 22-30.',
    'Struktur-Punkte: Flow, Belege, Payoff und umsetzbare Klarheit im Body; fehlender Body wird nur hier abgezogen.',
    'Gib 2-3 konkrete Änderungen, keine allgemeinen Schreib-Ratschläge. Formuliere positiv als Coach.',
    '',
    `Plattformregeln: ${PLATFORM_NOTES[input.platform]}`,
  ].join('\n');
}

function parseToolInput(input: unknown): RawImpactScore | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (!Number.isFinite(raw.hook_score) || !Number.isFinite(raw.structure_score)) return null;
  if (!isImpactFramework(raw.detected_framework)) return null;
  if (!Array.isArray(raw.improvements)) return null;
  const improvements = raw.improvements.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  if (improvements.length < 2) return null;

  return {
    hook_score: raw.hook_score as number,
    structure_score: raw.structure_score as number,
    detected_framework: raw.detected_framework,
    improvements,
    ...(typeof raw.hook_rewrite === 'string' ? { hook_rewrite: raw.hook_rewrite } : {}),
  };
}

function isImpactFramework(value: unknown): value is ImpactFramework {
  return (
    value === 'pia' ||
    value === 'hormozi_contrast' ||
    value === 'relatable_enemy' ||
    value === 'evidence_story' ||
    value === 'none'
  );
}

function clampModelScore(value: number): number {
  return Math.min(MAX_MODEL_SCORE, Math.max(0, Math.round(value)));
}
