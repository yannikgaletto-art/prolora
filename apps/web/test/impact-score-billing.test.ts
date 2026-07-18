// GOAL-RUN8 T1.3 — quota precedes spend and usage is recorded only after a valid result.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  assertQuota: vi.fn(),
  recordUsage: vi.fn(),
  getContext: vi.fn(),
  persistPrediction: vi.fn(),
}));

vi.mock('@/lib/ai/client', () => ({
  AI_MODEL: 'test-model',
  getAnthropicClient: () => ({ messages: { create: mocks.create } }),
}));
vi.mock('@/lib/usage/credits', () => ({
  assertCreditQuota: mocks.assertQuota,
  recordCreditUsage: mocks.recordUsage,
}));
vi.mock('@/lib/discovery/auto-context', () => ({
  getWorkspaceContext: mocks.getContext,
}));
vi.mock('@/lib/templates/render-prompt', () => ({
  PLATFORM_NOTES: { linkedin: 'LinkedIn rules' },
}));
vi.mock('@/lib/scoring/prediction-store', () => ({
  persistImpactPrediction: mocks.persistPrediction,
}));

import { scorePost } from '@/lib/scoring/score-service';

const deterministic = {
  formatting_score: 20,
  platform_hygiene_score: 20,
  checks: [],
  body_links: [],
  fold_text: 'Hook',
};

describe('scorePost billing order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertQuota.mockResolvedValue(undefined);
    mocks.recordUsage.mockResolvedValue(null);
    mocks.getContext.mockResolvedValue(null);
    mocks.persistPrediction.mockResolvedValue('prediction-1');
  });

  test('records one credit only after a valid tool result', async () => {
    mocks.create.mockResolvedValue({
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        {
          type: 'tool_use',
          input: {
            hook_score: 24,
            structure_score: 23,
            detected_framework: 'pia',
            improvements: ['Tighten the hook.', 'Add one proof point.'],
          },
        },
      ],
    });

    const result = await scorePost('workspace-1', {
      content: 'Hook\n\nBody',
      platform: 'linkedin',
      deterministic,
    });

    expect(result.virality_score).toBe(87);
    expect(mocks.assertQuota).toHaveBeenCalledBefore(mocks.create);
    expect(mocks.create).toHaveBeenCalledBefore(mocks.persistPrediction);
    expect(mocks.persistPrediction).toHaveBeenCalledBefore(mocks.recordUsage);
    expect(mocks.create).toHaveBeenCalledBefore(mocks.recordUsage);
    expect(mocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  test('does not record usage when the model call fails', async () => {
    mocks.create.mockRejectedValue(new Error('offline'));

    await expect(
      scorePost('workspace-1', {
        content: 'Hook\n\nBody',
        platform: 'linkedin',
        deterministic,
      })
    ).rejects.toMatchObject({ status: 502, code: 'ai_unavailable' });
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });
});
