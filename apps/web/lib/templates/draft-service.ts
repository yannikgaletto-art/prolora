// AI draft generation from a template (GOAL-RUN4 T1-4). Credit gate BEFORE the
// LLM call, charge AFTER success (Oracle 2/7); every DB access in this path is
// workspace-scoped (Invariante 2). Forced tool-use, never free-text JSON (R3).
import { CREDIT_COSTS, type PlatformType, type TemplateDraftResult } from '@prolora/shared';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { assertCreditQuota } from '@/lib/usage/credits';
import { getTemplateById } from '@/lib/templates/catalog';
import { buildTemplatePrompt } from '@/lib/templates/render-prompt';

const MAX_RETRIES = 1;

export interface GenerateTemplateDraftInput {
  templateId: string;
  slots: Record<string, string>;
  targetPlatforms: PlatformType[];
}

export async function generateTemplateDraft(
  workspaceId: string,
  input: GenerateTemplateDraftInput
): Promise<TemplateDraftResult & { credits_used: number }> {
  const template = getTemplateById(input.templateId);
  if (!template) {
    throw new ApiError(404, `Unknown template: ${input.templateId}`, 'template_not_found');
  }

  await assertCreditQuota(workspaceId, CREDIT_COSTS.template_draft);

  const context = await getWorkspaceContext(workspaceId);

  // Prefill empty slots from the workspace context, then enforce the
  // template's per-slot required flags (Zod cannot know them).
  const slots: Record<string, string> = { ...input.slots };
  for (const slot of template.slots) {
    const current = slots[slot.key]?.trim() ?? '';
    if (!current && slot.prefill_from && context?.[slot.prefill_from]) {
      slots[slot.key] = context[slot.prefill_from] as string;
    }
    if (!slots[slot.key]?.trim() && slot.required) {
      throw new ApiError(400, `Missing required answer: "${slot.question}"`, 'invalid_request');
    }
  }

  const prompt = buildTemplatePrompt({
    template,
    slots,
    targetPlatforms: input.targetPlatforms,
    context,
  });

  const client = getAnthropicClient();
  let strictNote = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let draft: { content: string; first_comment?: string; slides?: string[] } | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 2048,
        system: prompt.system,
        messages: [{ role: 'user', content: `${prompt.user}${strictNote}` }],
        tools: [
          {
            name: 'template_draft',
            description: 'Return the drafted post for the template',
            input_schema: {
              type: 'object' as const,
              properties: {
                content: {
                  type: 'string',
                  description: 'The complete post text (or the caption for carousel templates)',
                },
                first_comment: {
                  type: 'string',
                  description: 'Optional first comment (e.g. link + one context sentence)',
                },
                slides: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Slide texts (carousel) or the overlay sentence as slides[0] (screencast)',
                },
              },
              required: ['content'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'template_draft' },
      });
    } catch (error) {
      console.error('[templates] anthropic call failed:', error);
      throw new ApiError(502, 'AI draft generation is temporarily unavailable.', 'ai_unavailable');
    }

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    const toolBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      throw new ApiError(502, 'AI draft generation returned no result.', 'ai_unavailable');
    }
    const raw = toolBlock.input as Record<string, unknown>;
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    if (!content) {
      throw new ApiError(502, 'AI draft generation returned empty content.', 'ai_unavailable');
    }
    const firstComment =
      typeof raw.first_comment === 'string' && raw.first_comment.trim()
        ? raw.first_comment.trim()
        : undefined;
    const slides = Array.isArray(raw.slides)
      ? raw.slides.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : undefined;

    draft = {
      content,
      first_comment: firstComment,
      slides: slides && slides.length > 0 ? slides : undefined,
    };

    const length = measureLength(content, prompt.budgetPlatform);
    if (length <= prompt.characterBudget) break;
    // Over budget -> exactly one retry with a stricter note (adapt-content pattern).
    strictNote = `\n\nSTRICT: your last attempt had ${length} characters. Keep "content" UNDER ${Math.floor(
      prompt.characterBudget * 0.9
    )} characters this time.`;
  }

  if (!draft) {
    throw new ApiError(502, 'AI draft generation failed.', 'ai_unavailable');
  }

  // Charge only after success. Log failure must never eat the draft —
  // usage_logs is telemetry/billing, the user experience wins (GOAL-RUN4).
  const db = getServiceDb();
  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'template_draft',
    credits_used: CREDIT_COSTS.template_draft,
    metadata: {
      template_id: template.id,
      platforms: input.targetPlatforms,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: AI_MODEL,
    },
  });
  if (usageError) {
    console.error('[templates] usage log failed:', usageError.message);
  }

  return {
    ...draft,
    manual_steps: template.manual_steps,
    recommended_platforms: template.recommended_platforms,
    credits_used: CREDIT_COSTS.template_draft,
  };
}

// Bluesky counts graphemes, not characters (platform-rules.ts) — same
// measurement as lib/ai/adapt-content.ts.
function measureLength(text: string, platform: PlatformType): number {
  if (platform === 'bluesky') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    let count = 0;
    for (const _ of segmenter.segment(text)) count++;
    return count;
  }
  return text.length;
}
