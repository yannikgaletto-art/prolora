import { describe, expect, test } from 'vitest';
import { assertAiPostQaFresh } from '@/lib/pipeline/ai-post-qa';
import { sha256Hex } from '@/lib/writer/hash';

describe('AI post QA freshness precondition', () => {
  test('leaves wholly manual posts compatible', () => {
    expect(() => assertAiPostQaFresh({ resolvedContent: 'Manual text', qaContext: null })).not.toThrow();
  });

  test('accepts an unchanged writer post with a passing gate', () => {
    const content = 'Approved content';
    expect(() => assertAiPostQaFresh({
      resolvedContent: content,
      qaContext: {
        origin: 'writer', contentHash: sha256Hex(content), gateStatus: 'passed',
        gateVersion: 'narrative-gate-v1', generation: { factsHash: 'facts-a', sampleHash: 'samples-a' },
      },
      currentFactsHash: 'facts-a', currentSampleHash: 'samples-a',
    })).not.toThrow();
  });

  test.each([
    ['content', { resolvedContent: 'Edited', currentFactsHash: 'facts-a', currentSampleHash: 'samples-a' }],
    ['facts', { resolvedContent: 'Approved content', currentFactsHash: 'facts-b', currentSampleHash: 'samples-a' }],
    ['samples', { resolvedContent: 'Approved content', currentFactsHash: 'facts-a', currentSampleHash: 'samples-b' }],
  ])('blocks stale %s before publishing', (_name, overrides) => {
    expect(() => assertAiPostQaFresh({
      qaContext: {
        origin: 'writer', contentHash: sha256Hex('Approved content'), gateStatus: 'passed',
        gateVersion: 'narrative-gate-v1', generation: { factsHash: 'facts-a', sampleHash: 'samples-a' },
      },
      ...overrides,
    })).toThrow(/fresh QA/i);
  });

  test('blocks generated posts with missing or failed gate data', () => {
    expect(() => assertAiPostQaFresh({
      resolvedContent: 'Generated', qaContext: { origin: 'writer' },
    })).toThrow(/fresh QA/i);
  });
});
