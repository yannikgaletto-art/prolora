import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';

const BATCH_SIZE = 10;
const INTENT_TYPES = ['question', 'comparison', 'recommendation', 'complaint', 'discussion'] as const;

export interface ThreadCandidate {
  title: string;
  body: string;
  community: string;
}

export interface ThreadEvaluation {
  thread_index: number;
  relevant: boolean;
  relevance_score: number;
  intent_type: (typeof INTENT_TYPES)[number];
  intent_score: number;
  suggested_angle: string;
}

export interface EvaluationUsage {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
}

// Stage 2 of the Thread Radar filter: batches of 10 threads per LLM call
// (Blind Spot D1 — batching is what turns $144/day into ~$0.15/day).
export async function evaluateThreads(
  candidates: ThreadCandidate[],
  productDescription: string,
  targetAudience: string
): Promise<{ evaluations: ThreadEvaluation[]; usage: EvaluationUsage }> {
  const client = getAnthropicClient();
  const evaluations: ThreadEvaluation[] = [];
  const usage: EvaluationUsage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };

  for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + BATCH_SIZE);

    const threadList = batch
      .map(
        (thread, index) =>
          `[${index}] r/${thread.community} — "${thread.title}"\n${thread.body.slice(0, 500)}`
      )
      .join('\n\n');

    try {
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 2048,
        system:
          'You evaluate community threads for relevance to a product. Be strict: ' +
          'relevant=true only if a genuinely helpful reply related to the product domain is possible. ' +
          'suggested_angle describes HOW to add value — never how to pitch.',
        messages: [
          {
            role: 'user',
            content:
              `Product: ${productDescription}\nTarget audience: ${targetAudience}\n\n` +
              `Evaluate these ${batch.length} threads:\n\n${threadList}`,
          },
        ],
        tools: [
          {
            name: 'thread_evaluation',
            description: 'Return one evaluation per thread',
            input_schema: {
              type: 'object' as const,
              properties: {
                evaluations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      thread_index: { type: 'integer' },
                      relevant: { type: 'boolean' },
                      relevance_score: { type: 'number', description: '0.0-1.0' },
                      intent_type: { type: 'string', enum: [...INTENT_TYPES] },
                      intent_score: {
                        type: 'number',
                        description: '0.0-1.0: how actionable is the intent (buying/seeking help)',
                      },
                      suggested_angle: { type: 'string' },
                    },
                    required: [
                      'thread_index',
                      'relevant',
                      'relevance_score',
                      'intent_type',
                      'intent_score',
                      'suggested_angle',
                    ],
                  },
                },
              },
              required: ['evaluations'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'thread_evaluation' },
      });

      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.llmCalls += 1;

      const block = response.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') continue;

      const input = block.input as { evaluations?: unknown };
      if (!Array.isArray(input.evaluations)) continue;

      for (const raw of input.evaluations) {
        const evaluation = coerceEvaluation(raw, offset, batch.length);
        if (evaluation) evaluations.push(evaluation);
      }
    } catch (error) {
      // A failed batch skips those threads — the next radar run re-sees
      // anything still fresh. Never abort the whole scan.
      console.error('[evaluate-threads] batch failed:', error);
    }
  }

  return { evaluations, usage };
}

function coerceEvaluation(
  raw: unknown,
  offset: number,
  batchLength: number
): ThreadEvaluation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const localIndex = typeof record.thread_index === 'number' ? record.thread_index : -1;
  if (localIndex < 0 || localIndex >= batchLength) return null;

  const intent =
    typeof record.intent_type === 'string' &&
    (INTENT_TYPES as readonly string[]).includes(record.intent_type)
      ? (record.intent_type as (typeof INTENT_TYPES)[number])
      : 'discussion';

  return {
    thread_index: offset + localIndex,
    relevant: record.relevant === true,
    relevance_score: clamp01(record.relevance_score),
    intent_type: intent,
    intent_score: clamp01(record.intent_score),
    suggested_angle: typeof record.suggested_angle === 'string' ? record.suggested_angle : '',
  };
}

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : 0;
  return Math.max(0, Math.min(1, n));
}
