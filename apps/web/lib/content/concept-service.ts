// 3-draft concept generation (GOAL-RUN9 §8 T2.5). Credit gate BEFORE the LLM
// call, charge AFTER success (F4 pattern). Forced tool use, never free-text
// JSON. D5: the three concepts MUST cover the lenses evidence/founder/
// community — schema field + code check + one retry.
import {
  CREDIT_COSTS,
  type ConceptLens,
  type ConceptResponse,
  type ConceptSettings,
  type ContentGoal,
  type PlatformType,
  type PostConcept,
} from '@prolora/shared';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { assertCreditQuota } from '@/lib/usage/credits';
import { getPlatformRules } from '@/lib/validation/platform-rules';
import { listProofAssets, normalizeProfileFields } from '@/lib/product/profile';
import { listContentReferences } from '@/lib/content/references';
import { matchReferences } from '@/lib/content/reference-matcher';
import { LONGFORM_MIN_BUDGET, PLATFORM_NOTES } from '@/lib/templates/render-prompt';
import type { GenerationContext } from '@/lib/generation/types';

const MAX_RETRIES = 1;
const REQUIRED_LENSES: ConceptLens[] = ['evidence', 'founder', 'community'];

export interface GenerateConceptsInput {
  content_goal: ContentGoal;
  angle?: string;
  user_idea?: string;
  follow_up_answers?: string[];
  settings: ConceptSettings;
  target_platforms: PlatformType[];
  /** Explicit generation language; dashboard locale is never an implicit substitute. */
  output_language?: 'de' | 'en';
  generation_contexts?: GenerationContext[];
}

// Character windows per gear length setting (spec "Content Settings").
const LENGTH_WINDOWS: Record<ConceptSettings['length'], [number, number]> = {
  short: [400, 700],
  medium: [700, 1300],
  long: [1300, 2300],
};

/** Gear settings → prompt lines. Pure and exported for tests (T2.8). */
export function settingsToPromptLines(settings: ConceptSettings): string[] {
  const valueDensity = [
    '',
    'Value density 1/5: personal and observational — the insight may stay implicit.',
    'Value density 2/5: observational with one clear takeaway.',
    'Value density 3/5: story plus concrete, named learnings.',
    'Value density 4/5: concrete and actionable — every section earns its place with substance.',
    'Value density 5/5: maximum density — framework, data and actionable steps; zero filler.',
  ][settings.valueDensity];
  const community = [
    '',
    'Community commitment 1/5: pure thesis/insight, no question.',
    'Community commitment 2/5: end with a light, optional question.',
    'Community commitment 3/5: end with ONE genuine question readers can answer from experience.',
    'Community commitment 4/5: take a position and explicitly ask where readers disagree.',
    'Community commitment 5/5: openly debatable position — invite counter-arguments, promise to engage.',
  ][settings.communityCommitment];
  const vulnerability = [
    '',
    'Vulnerability 1/5: factual, no personal exposure.',
    'Vulnerability 2/5: one personal observation.',
    'Vulnerability 3/5: personal observation with real stakes (time, money, doubt).',
    'Vulnerability 4/5: name a mistake or doubt openly and what it cost.',
    'Vulnerability 5/5: full transparency — mistakes, doubts, course changes and what they taught.',
  ][settings.vulnerability];
  const tone: Record<ConceptSettings['tone'], string> = {
    reflective: 'Tone: reflective — thinking out loud, honest, no hype.',
    direct: 'Tone: direct — short sentences, clear claims, no hedging.',
    provocative: 'Tone: provocative — sharp but substantiated; provoke thought, not outrage.',
    educational: 'Tone: educational — explain mechanisms patiently and concretely.',
  };
  const [min, max] = LENGTH_WINDOWS[settings.length];
  return [
    `Length target for every canonical_content: ${min}–${max} characters.`,
    valueDensity,
    community,
    vulnerability,
    tone[settings.tone],
    settings.includeData
      ? 'Include real numbers/data — ONLY from the proof assets or user input below.'
      : 'Numbers are optional.',
    settings.includeFramework
      ? 'Make the underlying framework/structure explicit (named steps or a check order).'
      : 'Do not force a framework.',
    settings.includeCTA
      ? 'End with ONE soft, specific CTA.'
      : 'No CTA — at most a genuine question (if community commitment asks for one).',
  ];
}

/** D5 code check — pure and exported for tests. */
export function missingLenses(concepts: Pick<PostConcept, 'lens'>[]): ConceptLens[] {
  const present = new Set(concepts.map((concept) => concept.lens));
  return REQUIRED_LENSES.filter((lens) => !present.has(lens));
}

const CONCEPT_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    concepts: {
      type: 'array',
      description: 'Exactly 3 materially different post concepts — one per lens.',
      items: {
        type: 'object',
        properties: {
          lens: { type: 'string', enum: ['evidence', 'founder', 'community'] },
          title: { type: 'string', description: 'Short internal title (max 80 chars)' },
          angle: { type: 'string', description: 'One sentence: the content angle' },
          structure_label: {
            type: 'string',
            description: 'Which structure it follows (e.g. Analyse-Post, Strategiewechsel-Post)',
          },
          canonical_content: {
            type: 'string',
            description: 'The COMPLETE ready-to-edit post text in the workspace language',
          },
          rationale: {
            type: 'string',
            description: 'Why this fits the goal and product (1-2 sentences, workspace language)',
          },
          based_on_reference_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of the reference patterns this concept builds on (may be empty)',
          },
          risk_flag: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['lens', 'title', 'angle', 'structure_label', 'canonical_content', 'rationale', 'risk_flag'],
      },
    },
    follow_up_questions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'ONLY when the raw material is too thin for grounded drafts: max 3 concrete questions ' +
        'to the user (workspace language). Still return the best-effort concepts.',
    },
  },
  required: ['concepts'],
};

function parseConcepts(raw: Record<string, unknown>): PostConcept[] {
  if (!Array.isArray(raw.concepts)) return [];
  const concepts: PostConcept[] = [];
  for (const entry of raw.concepts) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as Record<string, unknown>;
    if (
      typeof c.lens !== 'string' ||
      !REQUIRED_LENSES.includes(c.lens as ConceptLens) ||
      typeof c.canonical_content !== 'string' ||
      !c.canonical_content.trim()
    ) {
      continue;
    }
    concepts.push({
      lens: c.lens as ConceptLens,
      title: typeof c.title === 'string' ? c.title.slice(0, 120) : '',
      angle: typeof c.angle === 'string' ? c.angle : '',
      structure_label: typeof c.structure_label === 'string' ? c.structure_label : '',
      canonical_content: c.canonical_content.trim(),
      rationale: typeof c.rationale === 'string' ? c.rationale : '',
      based_on_reference_ids: Array.isArray(c.based_on_reference_ids)
        ? c.based_on_reference_ids.filter((id): id is string => typeof id === 'string')
        : [],
      risk_flag:
        c.risk_flag === 'medium' || c.risk_flag === 'high' ? c.risk_flag : 'low',
    });
  }
  return concepts;
}

export async function generateConcepts(
  workspaceId: string,
  input: GenerateConceptsInput
): Promise<ConceptResponse> {
  await assertCreditQuota(workspaceId, CREDIT_COSTS.post_concepts);

  const [context, proofAssets, references] = await Promise.all([
    getWorkspaceContext(workspaceId),
    listProofAssets(workspaceId),
    listContentReferences(workspaceId),
  ]);
  const profile = normalizeProfileFields(context);

  let budget = Number.POSITIVE_INFINITY;
  for (const platform of input.target_platforms) {
    budget = Math.min(budget, getPlatformRules(platform).max_text_length);
  }
  const shortformFallback = budget < LONGFORM_MIN_BUDGET;

  const keywords = [
    ...profile.core_value,
    ...proofAssets.slice(0, 5).map((asset) => asset.content),
    input.user_idea ?? '',
    input.angle ?? '',
  ];
  const matched = matchReferences(references, input.content_goal, keywords, 3);

  const language = (input.output_language ?? context?.voice_language?.trim()) || 'de';
  const tone = context?.voice_tone?.trim() || 'casual';
  const [minLength] = LENGTH_WINDOWS[input.settings.length];
  const effectiveMax = Math.min(LENGTH_WINDOWS[input.settings.length][1], budget);

  const system = [
    'You are the content strategist behind Prolora for the DACH B2B market. You know the product',
    'below and produce THREE materially different post concepts — never three rewrites of the same',
    'premise. Return the result ONLY via the post_concepts tool.',
    '',
    `Output language for all user-facing strings: ${language}. Workspace voice tone: ${tone}.`,
    '',
    'The three concepts MUST cover exactly these lenses:',
    '- evidence: led by data, analysis, observation or a concrete example.',
    '- founder: led by a decision, mistake, strategy change or learning from building the product.',
    '- community: led by a strong, debatable position or an honest open question.',
    '',
    '--- GROUNDING (hard rules) ---',
    '- Claims about product performance require a proof asset below. No proof -> frame honestly as',
    '  founder hypothesis ("Meine Hypothese beim Bauen von X ist …", "In ersten Gesprächen habe ich beobachtet …").',
    '- NEVER invent numbers, users, quotes or events. Thin material -> shorter honest post + use',
    '  follow_up_questions (max 3) to ask for the missing concrete details.',
    '- Reference patterns below are STRUCTURE inspiration only — never copy their wording.',
    '--- END GROUNDING ---',
    '',
    'Writing quality: no generic openings ("In today\'s fast-paced world", "KI verändert alles").',
    'Every paragraph must introduce evidence, reveal an observation, explain a mechanism, give an',
    'action, or create justified tension. Short paragraphs, whitespace, strongest line first.',
    '',
    ...settingsToPromptLines(input.settings),
    `Hard ceiling per canonical_content: ${effectiveMax} characters${
      shortformFallback
        ? ' (a short-form platform is among the targets — write the sharpest short version; do not try to tell a long story)'
        : ''
    }. Floor: ${Math.min(minLength, effectiveMax)} characters when the material carries it.`,
    '',
    'Target platforms and their rules:',
    ...input.target_platforms.map((platform) => `- ${PLATFORM_NOTES[platform]}`),
  ].join('\n');

  const proofBlock =
    proofAssets.length > 0
      ? proofAssets
          .slice(0, 10)
          .map((asset) => `- [${asset.type}] ${asset.content}`)
          .join('\n')
      : '(none — every product claim must be framed as hypothesis/observation)';

  const referenceBlock =
    matched.length > 0
      ? matched
          .map(({ reference }) =>
            [
              `- id: ${reference.id}`,
              `  pattern: ${reference.reusable_pattern}`,
              `  structure: ${JSON.stringify(reference.structure)}`,
              `  why it worked: ${reference.why_it_worked.join(' | ')}`,
            ].join('\n')
          )
          .join('\n')
      : '(no matching patterns — rely on the lens definitions)';
  const generationContextBlock = (input.generation_contexts ?? []).map((generation) => [
    `Platform: ${generation.platform}; language: ${generation.language}`,
    `Product mention: ${generation.mention.decision} — ${generation.mention.reason}`,
    'Style rules:',
    ...generation.promptRules.map((rule) => `- ${rule.instruction}`),
    'Masked Golden Samples (style only; never copy wording or infer facts):',
    ...generation.samples.map((sample) => `- ${sample.maskedContent}`),
    'Confirmed facts valid at as_of:',
    ...generation.facts.map((fact) => `- ${fact.factKey} = ${JSON.stringify(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`),
  ].join('\n')).join('\n\n');

  const user = [
    `Product: ${context?.product_description ?? '(no description yet)'}`,
    `Target audience: ${context?.target_audience ?? '(unknown)'}`,
    profile.core_value.length > 0 ? `Core value:\n${profile.core_value.map((v) => `- ${v}`).join('\n')}` : '',
    profile.founder_perspective ? `Founder perspective: ${profile.founder_perspective}` : '',
    profile.taboo_topics.length > 0 ? `Taboo topics (never touch): ${profile.taboo_topics.join(', ')}` : '',
    '',
    `Content goal: ${input.content_goal}`,
    input.angle ? `Chosen angle: ${input.angle}` : '',
    input.user_idea ? `User idea / raw material:\n${input.user_idea}` : '',
    input.follow_up_answers && input.follow_up_answers.length > 0
      ? `Answers to your follow-up questions:\n${input.follow_up_answers.map((a) => `- ${a}`).join('\n')}`
      : '',
    '',
    'Proof assets (the ONLY permitted product claims):',
    proofBlock,
    '',
    'Reference patterns (structure inspiration only):',
    referenceBlock,
    generationContextBlock ? '\nGeneration context (binding):\n' + generationContextBlock : '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const client = getAnthropicClient();
  let strictNote = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let concepts: PostConcept[] = [];
  let followUps: string[] | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 8192,
        system,
        messages: [{ role: 'user', content: `${user}${strictNote}` }],
        tools: [
          {
            name: 'post_concepts',
            description: 'Return the three post concepts',
            input_schema: CONCEPT_TOOL_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'post_concepts' },
      });
    } catch (error) {
      console.error('[concepts] anthropic call failed:', error);
      throw new ApiError(502, 'Concept generation is temporarily unavailable.', 'ai_unavailable');
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const toolBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new ApiError(502, 'Concept generation returned no result.', 'ai_unavailable');
    }
    const raw = toolBlock.input as Record<string, unknown>;
    concepts = parseConcepts(raw);
    followUps = Array.isArray(raw.follow_up_questions)
      ? raw.follow_up_questions
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .slice(0, 3)
      : undefined;

    const missing = missingLenses(concepts);
    if (missing.length === 0 && concepts.length >= 3) break;
    // D5: one retry that names exactly what is missing.
    strictNote = `\n\nSTRICT: your last attempt was missing the lens(es): ${missing.join(', ')}. Return EXACTLY three concepts, one per lens (evidence, founder, community).`;
  }

  if (concepts.length < 3 || missingLenses(concepts).length > 0) {
    throw new ApiError(502, 'Concept generation failed to produce three distinct drafts.', 'ai_unavailable');
  }

  // Order deterministically for the UI: evidence, founder, community.
  concepts.sort(
    (a, b) => REQUIRED_LENSES.indexOf(a.lens) - REQUIRED_LENSES.indexOf(b.lens)
  );

  const db = getServiceDb();
  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'post_concepts',
    credits_used: CREDIT_COSTS.post_concepts,
    metadata: {
      content_goal: input.content_goal,
      platforms: input.target_platforms,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: AI_MODEL,
      // T2.7 observability
      lenses: concepts.map((concept) => concept.lens),
      draft_lengths: concepts.map((concept) => concept.canonical_content.length),
      budget: effectiveMax,
      shortform_fallback: shortformFallback,
      follow_ups: followUps?.length ?? 0,
      settings: input.settings,
    },
  });
  if (usageError) {
    console.error('[concepts] usage log failed:', usageError.message);
  }

  // Vault Phase 0 (T4.2): substantial raw material becomes a reusable proof
  // asset (founder_observation) — told once, usable in every future draft.
  // Best-effort: a failure here must never eat the generated concepts.
  const rawMaterial = input.user_idea?.trim();
  if (rawMaterial && rawMaterial.length >= 200) {
    const content = rawMaterial.slice(0, 2000);
    const { data: existing, error: lookupError } = await db
      .from('proof_assets')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('content', content)
      .limit(1);
    if (!lookupError && (existing ?? []).length === 0) {
      const { error: insertError } = await db.from('proof_assets').insert({
        workspace_id: workspaceId,
        type: 'founder_observation',
        content,
      });
      if (insertError) {
        console.error('[concepts] raw material save failed:', insertError.message);
      }
    }
  }

  return {
    concepts,
    follow_up_questions: followUps && followUps.length > 0 ? followUps : undefined,
    credits_used: CREDIT_COSTS.post_concepts,
  };
}
