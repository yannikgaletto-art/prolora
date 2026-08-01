import { describe, expect, test } from 'vitest';
import { resolveGenerationContext, resolveGenerationContexts } from '@/lib/generation/context';

const dependencies = {
  loadSamples: async () => [
    { id: 'one', kind: 'golden' as const, active: true, platform: 'linkedin', category: 'failure', hookType: 'confession', contentFormat: 'post', maskedContent: 'MASKED ONE', contentHash: 'a'.repeat(64) },
    { id: 'two', kind: 'golden' as const, active: true, platform: 'linkedin', category: 'failure', hookType: 'lesson', contentFormat: 'post', maskedContent: 'MASKED TWO', contentHash: 'b'.repeat(64) },
    { id: 'three', kind: 'golden' as const, active: true, platform: 'linkedin', category: 'failure', hookType: 'question', contentFormat: 'post', maskedContent: 'MASKED THREE', contentHash: 'c'.repeat(64) },
  ],
  loadFacts: async () => [{
    id: 'fact-1', factKey: 'pathly.status', factKind: 'current_state' as const,
    value: { text: 'active' }, unit: null, effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null, status: 'confirmed' as const, directionPolicy: 'free' as const,
    changeReason: null, verifiedAt: '2026-01-01T00:00:00.000Z',
  }],
  loadHistory: async () => [{ id: 'post-1', content: 'A post without product promotion.', publishedAt: '2026-07-20T00:00:00.000Z' }],
  loadPromptRules: async () => [{ key: 'voice', instruction: 'Use direct prose.', locked: false }],
};

describe('Generation Context Resolver', () => {
  test('contains only masked samples, confirmed facts and stable hashes', async () => {
    const context = await resolveGenerationContext('workspace-1', {
      language: 'de', platform: 'linkedin', category: 'failure',
      asOf: '2026-08-01T00:00:00.000Z', mentionMode: 'adaptive', productRelevant: true,
      communityRulesKnown: true,
    }, dependencies);

    expect(context.samples).toHaveLength(2);
    expect(context.samples.map((sample) => sample.maskedContent)).toEqual(['MASKED ONE', 'MASKED TWO']);
    expect(context.facts).toHaveLength(1);
    expect(context.sampleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(context.factsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(context.mention.decision).toBe('include');
  });

  test('both resolves independent de and en contexts from the same as-of snapshot', async () => {
    const contexts = await resolveGenerationContexts('workspace-1', {
      languages: ['de', 'en'], platform: 'linkedin', category: 'failure',
      asOf: '2026-08-01T00:00:00.000Z', mentionMode: 'exclude', productRelevant: true,
      communityRulesKnown: true,
    }, dependencies);
    expect(contexts.map((context) => context.language)).toEqual(['de', 'en']);
    expect(new Set(contexts.map((context) => context.factsHash)).size).toBe(1);
  });
});
