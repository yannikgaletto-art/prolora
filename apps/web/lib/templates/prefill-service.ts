// AI slot suggestions (GOAL-RUN5 G1/D2). Credit gate BEFORE the LLM call,
// charge AFTER success (same invariants as draft-service). The AI only ever
// SEES the template's 'angle' slots: 'fact' and 'erfahrung' slots are never
// sent, so it cannot invent user facts or experiences (T4, Oracle O4/O11).
// Unknown slot keys in the response are dropped code-side (D8).
import { CREDIT_COSTS, type SlotSuggestion } from '@prolora/shared';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';
import { getServiceDb } from '@/lib/db';
import { getWorkspaceContext } from '@/lib/discovery/auto-context';
import { assertCreditQuota } from '@/lib/usage/credits';
import { getTemplateById } from '@/lib/templates/catalog';

const MAX_SUGGESTION_LENGTH = 300;

export async function generateSlotSuggestions(
  workspaceId: string,
  templateId: string
): Promise<{ suggestions: SlotSuggestion[]; credits_used: number }> {
  const template = getTemplateById(templateId);
  if (!template) {
    throw new ApiError(404, `Unknown template: ${templateId}`, 'template_not_found');
  }

  // Angle gate (T3): templates without AI-fillable slots must never charge.
  // Checked BEFORE the quota gate so no code path can bill for empty output.
  const angleSlots = template.slots.filter((slot) => slot.kind === 'angle');
  if (angleSlots.length === 0) {
    throw new ApiError(
      400,
      'This template has no AI-fillable slots — it lives on your real experience.',
      'no_prefillable_slots'
    );
  }

  await assertCreditQuota(workspaceId, CREDIT_COSTS.template_prefill);

  const context = await getWorkspaceContext(workspaceId);
  if (!context?.product_description) {
    throw new ApiError(
      400,
      'Suggestions need your workspace context — set up Auto-Context under Discover first.',
      'context_required'
    );
  }

  const system =
    'Du hilfst einem Gründer, Antwortfelder für eine Social-Media-Post-Vorlage vorzubefüllen. ' +
    'Du bekommst seinen Produkt-Kontext und die Fragen der Vorlage. Schlage für JEDE Frage eine ' +
    'konkrete, spezifische Antwort auf Deutsch vor — kurz (max. 2 Sätze), im Ton eines Gründers, ' +
    'keine Marketing-Floskeln. STRIKT VERBOTEN: Zahlen, Ergebnisse, Erfahrungen oder Namen erfinden. ' +
    'Wenn eine gute Antwort eine echte Zahl bräuchte, formuliere ohne Zahl.';

  const user = [
    `PRODUKT-KONTEXT:\n${context.product_description}`,
    context.target_audience ? `ZIELGRUPPE:\n${context.target_audience}` : '',
    `VORLAGE: "${template.name}" — ${template.description}`,
    'FELDER (key · Frage · Hilfe · Beispiel als Stil-Referenz, NICHT kopieren):',
    ...angleSlots.map(
      (slot) => `- ${slot.key} · ${slot.question} · ${slot.help} · Beispiel: ${slot.example}`
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

  const client = getAnthropicClient();
  let response;
  try {
    response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
      tools: [
        {
          name: 'slot_suggestions',
          description: 'Return one suggestion per requested slot key',
          input_schema: {
            type: 'object' as const,
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string', description: 'The slot key, exactly as given' },
                    value: { type: 'string', description: 'The suggested answer (German)' },
                  },
                  required: ['key', 'value'],
                },
              },
            },
            required: ['suggestions'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'slot_suggestions' },
    });
  } catch (error) {
    console.error('[templates] prefill anthropic call failed:', error);
    throw new ApiError(502, 'AI suggestions are temporarily unavailable.', 'ai_unavailable');
  }

  const toolBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new ApiError(502, 'AI suggestions returned no result.', 'ai_unavailable');
  }

  // Code-enforced containment (D8/O11): only known angle-slot keys survive,
  // values are trimmed and capped — whatever the model claims.
  const angleKeys = new Set(angleSlots.map((slot) => slot.key));
  const raw = toolBlock.input as { suggestions?: Array<{ key?: unknown; value?: unknown }> };
  const suggestions: SlotSuggestion[] = [];
  for (const entry of raw.suggestions ?? []) {
    if (typeof entry.key !== 'string' || typeof entry.value !== 'string') continue;
    if (!angleKeys.has(entry.key)) continue;
    const value = entry.value.trim().slice(0, MAX_SUGGESTION_LENGTH);
    if (!value) continue;
    if (suggestions.some((s) => s.key === entry.key)) continue;
    suggestions.push({ key: entry.key, value, is_example: false });
  }
  if (suggestions.length === 0) {
    throw new ApiError(502, 'AI suggestions returned empty content.', 'ai_unavailable');
  }

  const db = getServiceDb();
  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: workspaceId,
    action: 'template_prefill',
    credits_used: CREDIT_COSTS.template_prefill,
    metadata: {
      template_id: template.id,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      model: AI_MODEL,
    },
  });
  if (usageError) {
    console.error('[templates] prefill usage log failed:', usageError.message);
  }

  return { suggestions, credits_used: CREDIT_COSTS.template_prefill };
}
