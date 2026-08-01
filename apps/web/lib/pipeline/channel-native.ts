// Plan 2 / 2B.3 — Kanal-native Erzeugung.
//
// Bisher kürzt lib/ai/adapt-content.ts einen fertigen Text nach unten. Hier
// entsteht stattdessen AUS DEM KONZEPT pro Kanal ein eigenes Artefakt: ein
// LinkedIn-Post und ein X-Thread aus derselben Idee sind zwei verschiedene
// Dinge, keine zwei Kürzungen desselben Textes.
//
// Kosten-Realität (§8): N Kanäle nativ = N LLM-Aufrufe statt einem. Bei 75
// Posts x 4 Kanälen wären das 300 statt 75. Deshalb BATCHING pro Konzept —
// ein Aufruf liefert mehrere Kanäle in einem strukturierten Tool-Result,
// dasselbe Muster wie evaluateCommunities in lib/discovery/community-mapper.ts.
// estimateChannelNativeCredits() liefert die Schätzung VOR dem Lauf.
import { CREDIT_COSTS, type PlatformType } from '@prolora/shared';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { adaptationLanguageInstruction, PLATFORM_STYLE } from '@/lib/ai/adapt-content';
import { ApiError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getPlatformRules } from '@/lib/validation/platform-rules';
import { RESONANCE_FIELDS } from '@/lib/pipeline/quality-gate';
import type { GenerationContext } from '@/lib/generation/types';

export type ChannelFormat = 'post' | 'thread' | 'article';

export interface ChannelTarget {
  /** Kanal = Konto. Ohne Verbindung: "platform:<name>". */
  channelKey: string;
  platform: PlatformType;
  connectionId: string | null;
  accountLabel?: string | null;
  characterLimit: number;
  format: ChannelFormat;
  /** Platz für spätere Konto-Profile (Tonalität/Tabus je Konto, §11). */
  notes?: string | null;
}

export interface ChannelNativeVariant {
  channelKey: string;
  platform: PlatformType;
  connectionId: string | null;
  format: ChannelFormat;
  content: string;
  segments: string[];
  structure: Record<string, string>;
  proofAssetIds: string[];
}

export interface ChannelNativeResult {
  variants: ChannelNativeVariant[];
  creditsUsed: number;
  calls: number;
  /** Kanäle, für die das Modell nichts geliefert hat — ehrlich benannt. */
  missingChannels: string[];
}

/** Wie viele Kanäle ein einzelner Aufruf abdeckt, bevor das Tool-Result kippt. */
export const MAX_CHANNELS_PER_CALL = 4;

const MAX_RETRIES = 1;

export function defaultFormatFor(platform: PlatformType): ChannelFormat {
  const rules = getPlatformRules(platform);
  if (platform === 'devto' || platform === 'hashnode') return 'article';
  if (rules.supports_thread && rules.max_text_length <= 500) return 'thread';
  return 'post';
}

export function channelTargetFromConnection(input: {
  connectionId: string | null;
  platform: PlatformType;
  accountLabel?: string | null;
  characterLimit?: number;
}): ChannelTarget {
  return {
    channelKey: input.connectionId ?? `platform:${input.platform}`,
    platform: input.platform,
    connectionId: input.connectionId,
    accountLabel: input.accountLabel ?? null,
    characterLimit: input.characterLimit ?? getPlatformRules(input.platform).max_text_length,
    format: defaultFormatFor(input.platform),
  };
}

const FORMAT_RULES: Record<ChannelFormat, string> = {
  post: 'One self-contained post. Strongest line first, short paragraphs, whitespace between them.',
  thread:
    'A thread. Segment 1 must work alone as a hook and must not be a teaser ("a thread 🧵" is banned). ' +
    'Every following segment carries ONE idea and stays under the character limit on its own. 3-7 segments.',
  article:
    'A Markdown article. First line = a concrete title (no "Introduction"). Sub-headings, code or ' +
    'lists where they earn their place, a closing rule of action.',
};

/** PLATFORM_STYLE bleibt die Regelquelle — hier nur um Format und Konto erweitert. */
export function channelStyleRules(target: ChannelTarget): string {
  return [
    `Platform style: ${PLATFORM_STYLE[target.platform]}`,
    `Format: ${FORMAT_RULES[target.format]}`,
    `Hard limit: ${target.characterLimit} characters${
      target.format === 'thread' ? ' PER SEGMENT' : ''
    }.`,
    target.accountLabel ? `Account: ${target.accountLabel}.` : '',
    target.notes ? `Channel notes: ${target.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface CreditEstimate {
  calls: number;
  credits: number;
  /** Was ein naiver Ansatz (ein Aufruf je Kanal) gekostet hätte. */
  naiveCredits: number;
  savedCredits: number;
}

/**
 * Credit-Schätzung VOR dem Lauf (§8). Rein und exportiert — die UI zeigt sie
 * an, bevor der Nutzer die Fabrik anwirft.
 */
export function estimateChannelNativeCredits(input: {
  conceptCount: number;
  channelCount: number;
  maxChannelsPerCall?: number;
}): CreditEstimate {
  const concepts = Math.max(0, Math.floor(input.conceptCount));
  const channels = Math.max(0, Math.floor(input.channelCount));
  const batch = Math.max(1, input.maxChannelsPerCall ?? MAX_CHANNELS_PER_CALL);
  const callsPerConcept = channels === 0 ? 0 : Math.ceil(channels / batch);
  const calls = concepts * callsPerConcept;
  const perCall = CREDIT_COSTS.content_adaptation;
  return {
    calls,
    credits: calls * perCall,
    naiveCredits: concepts * channels * perCall,
    savedCredits: concepts * channels * perCall - calls * perCall,
  };
}

export function chunkChannels<T>(targets: T[], size = MAX_CHANNELS_PER_CALL): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < targets.length; index += size) {
    chunks.push(targets.slice(index, index + size));
  }
  return chunks;
}

export interface GenerateChannelNativeInput {
  /** Das Konzept, aus dem nativ erzeugt wird — NICHT ein fertiger Post. */
  concept: {
    title: string;
    angle: string;
    canonicalContent: string;
    structureLabel?: string | null;
  };
  targets: ChannelTarget[];
  /** Belege, aus denen Zahlen stammen DÜRFEN — alles andere ist Fabrikation. */
  proofAssets: Array<{ id: string; type: string; content: string }>;
  /** Herkunft für die Kette in der UI. */
  evidenceSummary?: string | null;
  maxChannelsPerCall?: number;
  generationContexts?: GenerationContext[];
}

const VARIANT_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    variants: {
      type: 'array',
      description: 'Exactly one entry per requested channel_key.',
      items: {
        type: 'object',
        properties: {
          channel_key: { type: 'string' },
          format: { type: 'string', enum: ['post', 'thread', 'article'] },
          content: {
            type: 'string',
            description:
              'The complete channel-native text. For threads: all segments joined by a blank line.',
          },
          segments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Thread segments in order. Empty for post/article.',
          },
          structure: {
            type: 'object',
            description: 'The resonance schema this variant follows.',
            properties: {
              beweisbarer_ausgangspunkt: { type: 'string' },
              bruch: { type: 'string' },
              unerwarteter_befund: { type: 'string' },
              mechanismus: { type: 'string' },
              handlungsregel: { type: 'string' },
              reibungsfrage: { type: 'string' },
            },
            required: [
              'beweisbarer_ausgangspunkt',
              'bruch',
              'unerwarteter_befund',
              'mechanismus',
              'handlungsregel',
            ],
          },
          proof_asset_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of the proof assets whose numbers appear in the text.',
          },
        },
        required: ['channel_key', 'format', 'content', 'segments', 'structure', 'proof_asset_ids'],
      },
    },
  },
  required: ['variants'],
};

function parseVariants(
  raw: Record<string, unknown>,
  targets: ChannelTarget[]
): ChannelNativeVariant[] {
  if (!Array.isArray(raw.variants)) return [];
  const byKey = new Map(targets.map((target) => [target.channelKey, target]));
  const seen = new Set<string>();
  const variants: ChannelNativeVariant[] = [];

  for (const entry of raw.variants) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.channel_key === 'string' ? record.channel_key : '';
    const target = byKey.get(key);
    if (!target || seen.has(key)) continue;
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) continue;

    const structure: Record<string, string> = {};
    const rawStructure = (record.structure ?? {}) as Record<string, unknown>;
    for (const field of RESONANCE_FIELDS) {
      const value = rawStructure[field];
      if (typeof value === 'string' && value.trim()) structure[field] = value.trim();
    }

    seen.add(key);
    variants.push({
      channelKey: key,
      platform: target.platform,
      connectionId: target.connectionId,
      format:
        record.format === 'thread' || record.format === 'article' || record.format === 'post'
          ? record.format
          : target.format,
      content,
      segments: Array.isArray(record.segments)
        ? record.segments.filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        : [],
      structure,
      proofAssetIds: Array.isArray(record.proof_asset_ids)
        ? record.proof_asset_ids.filter((id): id is string => typeof id === 'string')
        : [],
    });
  }
  return variants;
}

async function workspaceLanguageInstruction(workspaceId: string): Promise<string> {
  const db = getServiceDb();
  const { data } = await db
    .from('voice_configs')
    .select('language')
    .eq('workspace_id', workspaceId)
    .maybeSingle<{ language: string }>();
  return adaptationLanguageInstruction(data?.language);
}

/**
 * Ein Aufruf, mehrere Kanäle. Der Aufrufer bekommt ausdrücklich zurück, welche
 * Kanäle NICHT geliefert wurden — stillschweigendes Auffüllen mit gekürztem
 * Text wäre genau das Verhalten, das dieser Baustein ersetzt.
 */
export async function generateChannelNativeVariants(
  workspaceId: string,
  input: GenerateChannelNativeInput
): Promise<ChannelNativeResult> {
  if (input.targets.length === 0) {
    return { variants: [], creditsUsed: 0, calls: 0, missingChannels: [] };
  }

  const explicitLanguage = input.generationContexts?.[0]?.language;
  const languageInstruction = explicitLanguage
    ? adaptationLanguageInstruction(explicitLanguage)
    : await workspaceLanguageInstruction(workspaceId);
  const batches = chunkChannels(input.targets, input.maxChannelsPerCall ?? MAX_CHANNELS_PER_CALL);
  const client = getAnthropicClient();

  const all: ChannelNativeVariant[] = [];
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const proofBlock =
    input.proofAssets.length > 0
      ? input.proofAssets
          .slice(0, 10)
          .map((asset) => `- id: ${asset.id} [${asset.type}] ${asset.content}`)
          .join('\n')
      : '(none — the text must then contain NO number, result or comparison at all)';

  for (const batch of batches) {
    const channelBlock = batch
      .map(
        (target) =>
          `channel_key: ${target.channelKey}\n${channelStyleRules(target)}`
      )
      .join('\n\n---\n\n');
    const contextBlock = batch.map((target) => {
      const context = input.generationContexts?.find((entry) => entry.platform === target.platform);
      if (!context) return '';
      return [
        `Context for ${target.channelKey}:`,
        `- language: ${context.language}`,
        `- product mention: ${context.mention.decision}; ${context.mention.reason}`,
        ...context.promptRules.map((rule) => `- style rule: ${rule.instruction}`),
        ...context.samples.map((sample) => `- masked style sample: ${sample.maskedContent}`),
        ...context.facts.map((fact) => `- confirmed fact: ${fact.factKey} = ${JSON.stringify(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`),
      ].join('\n');
    }).filter(Boolean).join('\n\n');

    const system = [
      'You write channel-native content for the Prolora content factory (DACH B2B).',
      'You do NOT shorten one finished text for several channels. You write ONE ORIGINAL',
      'artefact per channel from the same underlying idea — different opening, different',
      'rhythm, different length, same substance.',
      '',
      languageInstruction,
      '',
      '--- GROUNDING (hard rules, the quality gate enforces them) ---',
      '- Every number, result or comparison in the text MUST come from a proof asset below,',
      '  and you must list that asset id in proof_asset_ids.',
      '- NEVER invent numbers, users, quotes or events. Without a matching proof asset, write',
      '  the sentence WITHOUT a number instead of guessing one.',
      '- Each variant must fill the resonance schema — especially unerwarteter_befund. A draft',
      '  without an unexpected finding is a generic post and will be blocked.',
      '--- END GROUNDING ---',
      '',
      'Return exactly one entry per requested channel_key via the channel_variants tool.',
    ].join('\n');

    const user = [
      `Concept title: ${input.concept.title}`,
      `Angle: ${input.concept.angle}`,
      input.concept.structureLabel ? `Structure label: ${input.concept.structureLabel}` : '',
      input.evidenceSummary ? `Provenance: ${input.evidenceSummary}` : '',
      '',
      'Underlying material (the idea, NOT a text to shorten):',
      input.concept.canonicalContent,
      '',
      'Proof assets (the ONLY permitted source of numbers):',
      proofBlock,
      contextBlock ? `\nBinding generation context:\n${contextBlock}` : '',
      '',
      `Write for these ${batch.length} channels:`,
      channelBlock,
    ]
      .filter((line) => line !== '')
      .join('\n');

    let strictNote = '';
    let batchVariants: ChannelNativeVariant[] = [];

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
              name: 'channel_variants',
              description: 'Return one channel-native variant per requested channel',
              input_schema: VARIANT_TOOL_SCHEMA,
            },
          ],
          tool_choice: { type: 'tool', name: 'channel_variants' },
        });
      } catch (error) {
        console.error('[channel-native] anthropic call failed:', error);
        throw new ApiError(502, 'Channel-native generation is temporarily unavailable.', 'ai_unavailable');
      }

      calls += 1;
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const block = response.content.find((part) => part.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new ApiError(502, 'Channel-native generation returned no result.', 'ai_unavailable');
      }
      batchVariants = parseVariants(block.input as Record<string, unknown>, batch);

      const missing = batch
        .map((target) => target.channelKey)
        .filter((key) => !batchVariants.some((variant) => variant.channelKey === key));
      if (missing.length === 0) break;
      strictNote = `\n\nSTRICT: you did not return variants for: ${missing.join(', ')}. Return one entry per channel_key.`;
    }

    all.push(...batchVariants);
  }

  const missingChannels = input.targets
    .map((target) => target.channelKey)
    .filter((key) => !all.some((variant) => variant.channelKey === key));

  const creditsUsed = calls * CREDIT_COSTS.content_adaptation;
  if (creditsUsed > 0) {
    const db = getServiceDb();
    const { error } = await db.from('usage_logs').insert({
      workspace_id: workspaceId,
      // Vorhandene Aktion wiederverwendet: CREDIT_COSTS lebt in
      // packages/shared und wird in diesem Lauf nicht angefasst.
      action: 'content_adaptation',
      credits_used: creditsUsed,
      metadata: {
        mode: 'channel_native',
        channels: input.targets.length,
        batches: batches.length,
        calls,
        missing_channels: missingChannels.length,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model: AI_MODEL,
      },
    });
    if (error) {
      console.error('[channel-native] usage log failed:', error.message);
    }
  }

  return { variants: all, creditsUsed, calls, missingChannels };
}
