import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { getServiceDb } from '@/lib/db';
import { CREDIT_COSTS, type PlatformType } from '@prolora/shared';

const MAX_RETRIES = 2;

const PLATFORM_STYLE: Record<PlatformType, string> = {
  linkedin:
    'Professional but human tone. Short paragraphs with line breaks. 3-5 relevant hashtags at the end.',
  x: 'Punchy and concise. Hooks in the first line. At most 1-2 hashtags.',
  bluesky:
    'Casual, conversational, community-minded. No hashtag spam (0-2 max). Note: the limit is counted in graphemes.',
  mastodon: 'Thoughtful, community-oriented tone. Hashtags are welcome for discoverability (2-4).',
  telegram: 'Direct, informative channel-post style. No hashtags needed. Links in plain form.',
};

export interface PlatformTarget {
  platform: PlatformType;
  characterLimit: number;
}

export interface AdaptedContent {
  platform: PlatformType;
  content: string;
  adapted: boolean;
  warning?: string;
}

interface AdaptationUsage {
  inputTokens: number;
  outputTokens: number;
}

// Adapts one source text for N platforms IN PARALLEL (Promise.allSettled —
// sequential would cost the user 5-10s). Any failure falls back to the
// original content with a warning; adaptation NEVER blocks a post (R3).
export async function adaptContentForPlatforms(
  workspaceId: string,
  content: string,
  targets: PlatformTarget[]
): Promise<AdaptedContent[]> {
  const usage: AdaptationUsage = { inputTokens: 0, outputTokens: 0 };

  const settled = await Promise.allSettled(
    targets.map((target) => adaptForPlatform(content, target, usage))
  );

  const results: AdaptedContent[] = settled.map((outcome, index) => {
    const target = targets[index];
    if (outcome.status === 'fulfilled') {
      return outcome.value;
    }
    console.error(`[adapt-content] ${target.platform} adaptation failed:`, outcome.reason);
    return {
      platform: target.platform,
      content,
      adapted: false,
      warning: `Content adaptation for ${target.platform} failed — original content is used`,
    };
  });

  const adaptedCount = results.filter((r) => r.adapted).length;
  if (adaptedCount > 0) {
    await logUsage(workspaceId, adaptedCount, usage);
  }

  return results;
}

async function adaptForPlatform(
  content: string,
  target: PlatformTarget,
  usage: AdaptationUsage
): Promise<AdaptedContent> {
  const client = getAnthropicClient();
  let strictNote = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system:
        'You adapt social media content for specific platforms. Keep the core message, links and meaning intact. ' +
        'Write in the same language as the source text. Return the FINAL post text via the tool — ' +
        'including any hashtags you add.',
      messages: [
        {
          role: 'user',
          content:
            `Platform: ${target.platform}\n` +
            `Style: ${PLATFORM_STYLE[target.platform]}\n` +
            `Hard limit: ${target.characterLimit} characters.${strictNote}\n\n` +
            `Source text:\n${content}`,
        },
      ],
      tools: [
        {
          name: 'content_adaptation',
          description: 'Return the adapted post text for the target platform',
          input_schema: {
            type: 'object' as const,
            properties: {
              adapted_text: {
                type: 'string',
                description: 'The complete final post text, including hashtags',
              },
              hashtags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Hashtags used in the text (without #)',
              },
            },
            required: ['adapted_text', 'hashtags'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'content_adaptation' },
    });

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;

    const toolBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new Error('No tool_use block in adaptation response');
    }
    const input = toolBlock.input as { adapted_text?: unknown };
    const adaptedText = typeof input.adapted_text === 'string' ? input.adapted_text.trim() : '';
    if (!adaptedText) {
      throw new Error('Adaptation returned empty text');
    }

    const length = measureLength(adaptedText, target.platform);
    if (length <= target.characterLimit) {
      return { platform: target.platform, content: adaptedText, adapted: true };
    }

    // Too long -> retry with an explicitly stricter budget.
    strictNote = ` STRICT: your last attempt had ${length} characters. Stay UNDER ${Math.floor(
      target.characterLimit * 0.9
    )} characters this time.`;
  }

  return {
    platform: target.platform,
    content,
    adapted: false,
    warning: `Adaptation for ${target.platform} exceeded the limit after ${MAX_RETRIES + 1} attempts — original content is used`,
  };
}

function measureLength(text: string, platform: PlatformType): number {
  if (platform === 'bluesky') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(text)) count++;
    return count;
  }
  return text.length;
}

async function logUsage(
  workspaceId: string,
  adaptedCount: number,
  usage: AdaptationUsage
): Promise<void> {
  const db = getServiceDb();
  const { error } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'content_adaptation',
    credits_used: CREDIT_COSTS.content_adaptation * adaptedCount,
    metadata: {
      platforms_adapted: adaptedCount,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      model: AI_MODEL,
    },
  });
  if (error) {
    console.error('[adapt-content] usage log failed:', error.message);
  }
}
