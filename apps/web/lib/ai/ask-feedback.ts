import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { getServiceDb, type FeedbackItemRow } from '@/lib/db';

const MAX_ITEMS = 500;
const MAX_CONTENT_CHARS = 500;
const MAX_QUOTES = 5;

export interface AskFeedbackResult {
  answer: string;
  // 0 signals "not chargeable" to the route: no data, or the LLM call failed.
  confidence: number;
  based_on_count: number;
  key_quotes: string[];
  input_tokens: number;
  output_tokens: number;
}

type AskRow = Pick<
  FeedbackItemRow,
  | 'summary_en'
  | 'summary_de'
  | 'original_content'
  | 'sentiment'
  | 'category'
  | 'urgency'
  | 'topics'
  | 'rating'
  | 'source_platform'
  | 'created_at'
>;

// Natural-language Q&A over the workspace's feedback via forced tool-use
// (same pattern as analyze-feedback — NEVER free-text JSON parsing).
// Never throws past the service boundary: any failure degrades to a
// confidence-0 fallback so the route can skip charging credits.
export async function askFeedback(workspaceId: string, question: string): Promise<AskFeedbackResult> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('feedback_items')
    .select(
      'summary_en, summary_de, original_content, sentiment, category, urgency, topics, rating, source_platform, created_at'
    )
    .eq('workspace_id', workspaceId)
    .eq('is_duplicate', false)
    .order('created_at', { ascending: false })
    .limit(MAX_ITEMS)
    .returns<AskRow[]>();

  if (error) {
    console.error(`[ask-feedback] failed: ${error.message}`);
    return fallbackResult();
  }

  const items = data ?? [];
  if (items.length === 0) {
    // No data -> answer directly WITHOUT an LLM call; the route must not
    // charge credits (confidence 0).
    return {
      answer:
        'Es liegt noch kein Feedback vor, auf dessen Basis diese Frage beantwortet werden könnte. ' +
        'Verbinde zuerst eine Feedback-Quelle.',
      confidence: 0,
      based_on_count: 0,
      key_quotes: [],
      input_tokens: 0,
      output_tokens: 0,
    };
  }

  const compactItems = items.map((item) => ({
    summary_en: item.summary_en,
    summary_de: item.summary_de,
    content: item.original_content.slice(0, MAX_CONTENT_CHARS),
    sentiment: item.sentiment,
    category: item.category,
    urgency: item.urgency,
    topics: item.topics,
    rating: item.rating,
    source_platform: item.source_platform,
    created_at: item.created_at,
  }));

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1500,
      system:
        'You answer questions about customer feedback for a SaaS product team. ' +
        'Base your answer ONLY on the feedback items provided — never invent data. ' +
        'Answer in the language of the question. Set confidence (0-1) by how well the ' +
        'available feedback covers the question, based_on_count to the number of items ' +
        'your answer actually draws on, and key_quotes to up to 5 short verbatim quotes ' +
        'from the feedback that support the answer.',
      messages: [
        {
          role: 'user',
          content:
            `Question: ${question}\n\n` +
            `Feedback items (${compactItems.length}, most recent first):\n` +
            JSON.stringify(compactItems),
        },
      ],
      tools: [
        {
          name: 'answer_feedback_question',
          description: 'Return the structured answer to the feedback question',
          input_schema: {
            type: 'object' as const,
            properties: {
              answer: { type: 'string', description: 'The answer to the question' },
              confidence: {
                type: 'number',
                description: '0.0 (no supporting data) to 1.0 (fully supported by the feedback)',
              },
              based_on_count: {
                type: 'number',
                description: 'Number of feedback items the answer is based on',
              },
              key_quotes: {
                type: 'array',
                items: { type: 'string' },
                description: 'Up to 5 short verbatim quotes from the feedback supporting the answer',
              },
            },
            required: ['answer', 'confidence', 'based_on_count', 'key_quotes'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'answer_feedback_question' },
    });

    const block = response.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      throw new Error('No tool_use block in ask response');
    }

    return {
      ...coerceAnswer(block.input, items.length),
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  } catch (error) {
    console.error(
      `[ask-feedback] failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return fallbackResult();
  }
}

function fallbackResult(): AskFeedbackResult {
  return {
    answer: 'Analyse konnte nicht durchgeführt werden.',
    confidence: 0,
    based_on_count: 0,
    key_quotes: [],
    input_tokens: 0,
    output_tokens: 0,
  };
}

// Validate + clamp the tool output — model output stays untrusted even when
// it comes from a forced tool call.
function coerceAnswer(
  input: unknown,
  loadedCount: number
): Pick<AskFeedbackResult, 'answer' | 'confidence' | 'based_on_count' | 'key_quotes'> {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Tool input is not an object');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.answer !== 'string' || raw.answer.trim().length === 0) {
    throw new Error('answer missing');
  }
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : NaN;
  if (Number.isNaN(confidence)) {
    throw new Error('confidence missing');
  }

  const basedOn = typeof raw.based_on_count === 'number' ? Math.round(raw.based_on_count) : 0;

  return {
    answer: raw.answer.trim(),
    confidence: Math.max(0, Math.min(1, confidence)),
    based_on_count: Math.max(0, Math.min(loadedCount, basedOn)),
    key_quotes: Array.isArray(raw.key_quotes)
      ? raw.key_quotes.filter((q): q is string => typeof q === 'string').slice(0, MAX_QUOTES)
      : [],
  };
}
