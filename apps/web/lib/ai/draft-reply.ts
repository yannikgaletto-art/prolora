import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import type {
  DiscoveryCommunityRow,
  OpportunityThreadRow,
  ResponseMapRow,
  VoiceConfigRow,
} from '@/lib/db';
import type { GenerationContext } from '@/lib/generation/types';
import { renderGroundedContext } from '@/lib/generation/manual';

// Non-negotiable defaults (Invariante D3) — merged with the user's list.
const HARD_AVOID_PATTERNS = ['check out my tool', 'i built x', 'i built something', 'shameless plug'];

export interface DraftReplyInput {
  thread: OpportunityThreadRow;
  community: DiscoveryCommunityRow | null;
  voice: VoiceConfigRow | null;
  responseMapEntries: ResponseMapRow[];
  productContext: string;
  generationContext: GenerationContext;
}

export interface DraftReplyOutput {
  content: string;
  reasoning: string;
  suggestedFollowUp?: string;
  complianceWarnings: string[];
  inputTokens: number;
  outputTokens: number;
}

// Draft a HUMAN reply (FABLE-04 Abschnitt 7). The draft is text for the
// user to copy — Prolora never posts it anywhere (Invariante D1).
export async function draftReply(input: DraftReplyInput): Promise<DraftReplyOutput> {
  const client = getAnthropicClient();
  const voice = input.voice;
  const avoidPatterns = [
    ...new Set([
      ...HARD_AVOID_PATTERNS,
      ...(voice?.avoid_patterns ?? []).map((p) => p.toLowerCase()),
    ]),
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let draft: { content: string; reasoning: string; suggested_follow_up?: string } | null = null;

  const systemPrompt =
    'Du schreibst eine Antwort auf einen Community-Thread als echter Mensch, NICHT als Bot oder Marketer.\n\n' +
    'Nicht verhandelbare Regeln:\n' +
    (input.generationContext.mention.decision === 'omit'
      ? '- KEIN Produkt-Pitch und keine Erwähnung von Pathly oder Prolora.\n'
      : '- Pathly höchstens einmal als transparente, hilfreiche Einordnung erwähnen; kein Pitch.\n') +
    `- Verbotene Formulierungen: ${avoidPatterns.join(', ')}\n` +
    '- Beantworte die Frage ZUERST mit echtem Mehrwert aus eigener Erfahrung.\n' +
    `- Sprache: ${voice?.language ?? 'de'}\n` +
    `- Ton: ${voice?.tone ?? 'casual'}\n` +
    `- Maximal ${voice?.max_reply_length ?? 500} Zeichen.\n` +
    (voice?.include_personal_experience !== false
      ? '- Schreibe aus persönlicher Erfahrung ("ich habe...", "bei uns...").\n'
      : '') +
    (input.community?.rules_summary
      ? `- Community-Regeln (einhalten!): ${input.community.rules_summary}\n`
      : '');

  const fewShot =
    input.responseMapEntries.length > 0
      ? '\n\nBewährte Antworten auf ähnliche Fragen (Inspiration, NICHT kopieren):\n' +
        input.responseMapEntries
          .map(
            (entry) =>
              `- Frage-Typ: "${entry.question_pattern}" → Antwort (Ø ${entry.avg_engagement} Engagement): "${entry.best_answer.slice(0, 400)}"`
          )
          .join('\n')
      : '';

  const exampleReplies =
    voice && voice.example_replies.length > 0
      ? `\n\nSo klingt der User normalerweise:\n${voice.example_replies
          .slice(0, 3)
          .map((reply) => `- "${reply.slice(0, 300)}"`)
          .join('\n')}`
      : '';

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1500,
      system:
        systemPrompt +
        (attempt > 0
          ? '\nSTRIKT: Dein letzter Entwurf enthielt verbotene Formulierungen oder war zu werblich. Diesmal: NUR hilfreicher Inhalt, null Produktbezug.'
          : ''),
      messages: [
        {
          role: 'user',
          content:
            `Thread-Titel: ${input.thread.thread_title}\n` +
            `Thread-Inhalt: ${(input.thread.thread_body ?? '').slice(0, 3000)}\n` +
            `Community: ${input.thread.community_name}\n` +
            `Vorgeschlagener Winkel: ${input.thread.suggested_angle ?? 'freie Wahl'}\n` +
            `Produkt-Kontext: ${input.productContext.slice(0, 1000)}\n` +
            `Verbindlicher Generierungskontext:\n${renderGroundedContext([input.generationContext])}` +
            fewShot +
            exampleReplies,
        },
      ],
      tools: [
        {
          name: 'draft_reply',
          description: 'Return the drafted reply',
          input_schema: {
            type: 'object' as const,
            properties: {
              content: { type: 'string', description: 'The reply text, nothing else' },
              reasoning: {
                type: 'string',
                description: 'One sentence: why this angle adds value (for the user, not the reply)',
              },
              suggested_follow_up: {
                type: 'string',
                description: 'Optional: when/how a product mention could fit in a LATER comment',
              },
            },
            required: ['content', 'reasoning'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'draft_reply' },
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') continue;
    const raw = block.input as Record<string, unknown>;
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content) continue;

    // Hard gate (Invariante D3): forbidden phrases end the attempt, period.
    const lower = content.toLowerCase();
    const violation = avoidPatterns.find((pattern) => lower.includes(pattern));
    if (violation) {
      console.warn(`[draft-reply] attempt ${attempt + 1} contained "${violation}" — regenerating`);
      continue;
    }

    draft = {
      content,
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
      ...(typeof raw.suggested_follow_up === 'string' && raw.suggested_follow_up
        ? { suggested_follow_up: raw.suggested_follow_up }
        : {}),
    };
    break;
  }

  if (!draft) {
    throw new Error('Draft generation failed — no compliant draft after 2 attempts');
  }

  // Compliance check against the community rules (second opinion).
  const complianceWarnings = await checkCompliance(
    client,
    draft.content,
    input.community?.rules_summary ?? null,
    (tokens) => {
      inputTokens += tokens.input;
      outputTokens += tokens.output;
    }
  );

  return {
    content: draft.content,
    reasoning: draft.reasoning,
    suggestedFollowUp: draft.suggested_follow_up,
    complianceWarnings,
    inputTokens,
    outputTokens,
  };
}

async function checkCompliance(
  client: ReturnType<typeof getAnthropicClient>,
  draftContent: string,
  rulesSummary: string | null,
  addTokens: (tokens: { input: number; output: number }) => void
): Promise<string[]> {
  if (!rulesSummary) return [];
  try {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content:
            `Community-Regeln:\n${rulesSummary}\n\nGeplanter Reply:\n${draftContent}\n\n` +
            'Verstößt dieser Text gegen die Regeln oder wirkt er werblich?',
        },
      ],
      tools: [
        {
          name: 'compliance_check',
          description: 'Return the compliance result',
          input_schema: {
            type: 'object' as const,
            properties: {
              compliant: { type: 'boolean' },
              warnings: { type: 'array', items: { type: 'string' } },
            },
            required: ['compliant', 'warnings'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'compliance_check' },
    });
    addTokens({ input: response.usage.input_tokens, output: response.usage.output_tokens });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return [];
    const raw = block.input as { compliant?: unknown; warnings?: unknown };
    if (raw.compliant === true) return [];
    return Array.isArray(raw.warnings)
      ? raw.warnings.filter((w): w is string => typeof w === 'string').slice(0, 5)
      : ['Compliance-Check meldete Probleme ohne Details'];
  } catch (error) {
    console.error('[draft-reply] compliance check failed:', error);
    return ['Compliance-Check fehlgeschlagen — Regeln manuell prüfen'];
  }
}
