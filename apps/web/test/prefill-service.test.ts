// Oracle O11: prefill security invariants — angle gate BEFORE quota, quota
// BEFORE the LLM, charge AFTER success, code-side containment of whatever
// the model returns, and no slot contents in usage metadata.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDIT_COSTS } from '@prolora/shared';

const mocks = vi.hoisted(() => ({
  messagesCreate: vi.fn(),
  assertCreditQuota: vi.fn(),
  getWorkspaceContext: vi.fn(),
  usageInsert: vi.fn(),
}));

vi.mock('@/lib/ai/client', () => ({
  AI_MODEL: 'test-model',
  getAnthropicClient: () => ({ messages: { create: mocks.messagesCreate } }),
}));
vi.mock('@/lib/usage/credits', () => ({ assertCreditQuota: mocks.assertCreditQuota }));
vi.mock('@/lib/discovery/auto-context', () => ({
  getWorkspaceContext: mocks.getWorkspaceContext,
}));
vi.mock('@/lib/db', () => ({
  getServiceDb: () => ({ from: () => ({ insert: mocks.usageInsert }) }),
}));

import { generateSlotSuggestions } from '@/lib/templates/prefill-service';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';

// Real catalog fixtures: one template WITH angle slots (and at least one
// non-angle slot), one without any — both must exist by curation (T4).
const angleTemplate = TEMPLATE_CATALOG.find(
  (t) => t.slots.some((s) => s.kind === 'angle') && t.slots.some((s) => s.kind !== 'angle')
)!;
const noAngleTemplate = TEMPLATE_CATALOG.find((t) => t.slots.every((s) => s.kind !== 'angle'))!;
const angleKey = angleTemplate.slots.find((s) => s.kind === 'angle')!.key;
const nonAngleSlot = angleTemplate.slots.find((s) => s.kind !== 'angle')!;

function aiResponse(suggestions: Array<{ key: string; value: string }>) {
  return {
    content: [{ type: 'tool_use', name: 'slot_suggestions', input: { suggestions } }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCreditQuota.mockResolvedValue(undefined);
  mocks.getWorkspaceContext.mockResolvedValue({
    product_description: 'Prolora — Social-Publishing für Gründer',
    target_audience: 'Solo-Founder',
  });
  mocks.usageInsert.mockResolvedValue({ error: null });
  mocks.messagesCreate.mockResolvedValue(aiResponse([{ key: angleKey, value: ' Ein Vorschlag ' }]));
});

describe('gates in the right order', () => {
  it('unknown template → 404, nothing else runs', async () => {
    await expect(generateSlotSuggestions('ws-1', 'gibts-nicht')).rejects.toMatchObject({
      status: 404,
      code: 'template_not_found',
    });
    expect(mocks.assertCreditQuota).not.toHaveBeenCalled();
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });

  it('template without angle slots → 400 BEFORE the quota check (never charge for nothing)', async () => {
    await expect(generateSlotSuggestions('ws-1', noAngleTemplate.id)).rejects.toMatchObject({
      status: 400,
      code: 'no_prefillable_slots',
    });
    expect(mocks.assertCreditQuota).not.toHaveBeenCalled();
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });

  it('quota failure stops everything before the LLM', async () => {
    mocks.assertCreditQuota.mockRejectedValue(new Error('quota exceeded'));
    await expect(generateSlotSuggestions('ws-1', angleTemplate.id)).rejects.toThrow();
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
    expect(mocks.usageInsert).not.toHaveBeenCalled();
  });

  it('missing workspace context → 400 context_required, no LLM call', async () => {
    mocks.getWorkspaceContext.mockResolvedValue(null);
    await expect(generateSlotSuggestions('ws-1', angleTemplate.id)).rejects.toMatchObject({
      status: 400,
      code: 'context_required',
    });
    expect(mocks.messagesCreate).not.toHaveBeenCalled();
  });
});

describe('containment (O4/O11 — the model never decides what survives)', () => {
  it('only known angle keys survive; trims, caps at 300, dedupes, is_example false', async () => {
    mocks.messagesCreate.mockResolvedValue(
      aiResponse([
        { key: angleKey, value: '  gültig  ' },
        { key: angleKey, value: 'duplikat wird verworfen' },
        { key: nonAngleSlot.key, value: 'darf NIE ankommen (fact/erfahrung)' },
        { key: 'voellig-unbekannt', value: 'weg damit' },
      ])
    );
    const result = await generateSlotSuggestions('ws-1', angleTemplate.id);
    expect(result.suggestions).toEqual([{ key: angleKey, value: 'gültig', is_example: false }]);
    expect(result.credits_used).toBe(CREDIT_COSTS.template_prefill);
  });

  it('caps runaway values at 300 characters', async () => {
    mocks.messagesCreate.mockResolvedValue(aiResponse([{ key: angleKey, value: 'a'.repeat(999) }]));
    const result = await generateSlotSuggestions('ws-1', angleTemplate.id);
    expect(result.suggestions[0]!.value).toHaveLength(300);
  });

  it('never sends fact/erfahrung slots to the model (T4)', async () => {
    await generateSlotSuggestions('ws-1', angleTemplate.id);
    const call = mocks.messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ content: string }>;
    };
    const prompt = call.messages[0]!.content;
    expect(prompt).toContain(angleKey);
    expect(prompt).not.toContain(nonAngleSlot.question);
  });

  it('suggestions with only unknown keys → 502 (no silent empty success)', async () => {
    mocks.messagesCreate.mockResolvedValue(aiResponse([{ key: 'unbekannt', value: 'x' }]));
    await expect(generateSlotSuggestions('ws-1', angleTemplate.id)).rejects.toMatchObject({
      status: 502,
      code: 'ai_unavailable',
    });
    expect(mocks.usageInsert).not.toHaveBeenCalled();
  });
});

describe('billing (charge AFTER success only)', () => {
  it('LLM failure → 502 and NO usage log', async () => {
    mocks.messagesCreate.mockRejectedValue(new Error('api down'));
    await expect(generateSlotSuggestions('ws-1', angleTemplate.id)).rejects.toMatchObject({
      status: 502,
      code: 'ai_unavailable',
    });
    expect(mocks.usageInsert).not.toHaveBeenCalled();
  });

  it('success logs template_prefill without any slot contents in metadata', async () => {
    await generateSlotSuggestions('ws-1', angleTemplate.id);
    expect(mocks.usageInsert).toHaveBeenCalledTimes(1);
    const row = mocks.usageInsert.mock.calls[0]![0] as {
      workspace_id: string;
      action: string;
      credits_used: number;
      metadata: Record<string, unknown>;
    };
    expect(row.workspace_id).toBe('ws-1');
    expect(row.action).toBe('template_prefill');
    expect(row.credits_used).toBe(CREDIT_COSTS.template_prefill);
    // Privacy invariant: metadata may carry ids and token counts, never text.
    expect(Object.keys(row.metadata).sort()).toEqual([
      'input_tokens',
      'model',
      'output_tokens',
      'template_id',
    ]);
  });
});
