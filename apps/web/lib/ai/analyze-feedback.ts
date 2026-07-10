import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import type { FeedbackAnalysis } from '@prolora/shared';

const SENTIMENTS = ['positive', 'negative', 'neutral', 'mixed'] as const;
const CATEGORIES = ['bug', 'feature_request', 'praise', 'complaint', 'question', 'other'] as const;
const URGENCIES = ['low', 'medium', 'high', 'critical'] as const;

// Structured feedback analysis via tool-use — NEVER free-text JSON parsing
// (Risiko R3). Returns null after 2 failed attempts; the caller stores the
// raw feedback with sentiment=null instead of losing it (Invariante 4).
export async function analyzeFeedback(
  content: string,
  context?: { platform?: string; rating?: number | null; author?: string | null }
): Promise<{ analysis: FeedbackAnalysis; inputTokens: number; outputTokens: number } | null> {
  // Missing key must degrade to the null path, not reject before the retry
  // loop — otherwise the caller's save-without-analysis fallback is unreachable.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[analyze-feedback] skipped: ANTHROPIC_API_KEY not configured');
    return null;
  }
  const client = getAnthropicClient();
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 1024,
        system:
          'You analyze customer feedback for a SaaS product team. Be precise and conservative: ' +
          'only mark urgency=critical for churn threats, security issues, data loss or legal risk. ' +
          (attempt > 0
            ? 'STRICT MODE: your previous attempt failed validation — fill EVERY field exactly per schema.'
            : ''),
        messages: [
          {
            role: 'user',
            content:
              `Analyze this feedback${context?.platform ? ` from ${context.platform}` : ''}` +
              `${context?.rating != null ? ` (rating: ${context.rating}/5)` : ''}:\n\n${content.slice(0, 6000)}`,
          },
        ],
        tools: [
          {
            name: 'feedback_analysis',
            description: 'Return the structured analysis of the feedback',
            input_schema: {
              type: 'object' as const,
              properties: {
                sentiment: { type: 'string', enum: [...SENTIMENTS] },
                sentiment_score: {
                  type: 'number',
                  description: '-1.0 (very negative) to 1.0 (very positive)',
                },
                language: { type: 'string', description: 'ISO 639-1 code of the feedback language' },
                category: { type: 'string', enum: [...CATEGORIES] },
                summary_de: { type: 'string', description: 'One-sentence summary in German' },
                summary_en: { type: 'string', description: 'One-sentence summary in English' },
                topics: { type: 'array', items: { type: 'string' }, description: '1-5 topic tags' },
                urgency: { type: 'string', enum: [...URGENCIES] },
                actionable: { type: 'boolean' },
                suggested_action: {
                  type: ['string', 'null'],
                  description: 'Concrete next step for the team, or null',
                },
              },
              required: [
                'sentiment',
                'sentiment_score',
                'language',
                'category',
                'summary_de',
                'summary_en',
                'topics',
                'urgency',
                'actionable',
                'suggested_action',
              ],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'feedback_analysis' },
      });

      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const block = response.content.find((b) => b.type === 'tool_use');
      if (!block || block.type !== 'tool_use') {
        throw new Error('No tool_use block in analysis response');
      }
      const analysis = coerceAnalysis(block.input);
      return { analysis, inputTokens, outputTokens };
    } catch (error) {
      console.error(`[analyze-feedback] attempt ${attempt + 1} failed:`, error);
    }
  }

  return null;
}

// Validate + clamp the tool output — external data stays untrusted even
// when it comes from a forced tool call.
function coerceAnalysis(input: unknown): FeedbackAnalysis {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Tool input is not an object');
  }
  const raw = input as Record<string, unknown>;

  const sentiment = pickEnum(raw.sentiment, SENTIMENTS);
  const category = pickEnum(raw.category, CATEGORIES);
  const urgency = pickEnum(raw.urgency, URGENCIES);
  if (!sentiment || !category || !urgency) {
    throw new Error('Tool input has invalid enum values');
  }

  const score = typeof raw.sentiment_score === 'number' ? raw.sentiment_score : NaN;
  if (Number.isNaN(score)) {
    throw new Error('sentiment_score missing');
  }

  return {
    sentiment,
    sentiment_score: Math.max(-1, Math.min(1, score)),
    language: typeof raw.language === 'string' ? raw.language.slice(0, 8) : 'unknown',
    category,
    summary_de: typeof raw.summary_de === 'string' ? raw.summary_de : '',
    summary_en: typeof raw.summary_en === 'string' ? raw.summary_en : '',
    topics: Array.isArray(raw.topics)
      ? raw.topics.filter((t): t is string => typeof t === 'string').slice(0, 5)
      : [],
    urgency,
    actionable: raw.actionable === true,
    suggested_action: typeof raw.suggested_action === 'string' ? raw.suggested_action : null,
  };
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}
