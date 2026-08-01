import { describe, expect, test } from 'vitest';
import { createQaSnapshot, verifyQaFreshness } from '@/lib/pipeline/qa-snapshot';

describe('QA snapshot freshness', () => {
  test('binds content, facts, samples, language, mention and gate version', () => {
    const snapshot = createQaSnapshot({
      content: 'A grounded post.', factsHash: 'facts-a', sampleHash: 'samples-a',
      language: 'en', mentionDecision: 'omit', gateVersion: 'narrative-gate-v1', gatePassed: true,
    });
    expect(verifyQaFreshness(snapshot, {
      content: 'A grounded post.', factsHash: 'facts-a', sampleHash: 'samples-a',
      language: 'en', mentionDecision: 'omit', gateVersion: 'narrative-gate-v1',
    })).toEqual({ fresh: true, reasons: [] });
  });

  test('invalidates approval after text, facts, samples, or gate version changes', () => {
    const snapshot = createQaSnapshot({
      content: 'Original.', factsHash: 'facts-a', sampleHash: 'samples-a',
      language: 'de', mentionDecision: 'include', gateVersion: 'narrative-gate-v1', gatePassed: true,
    });
    const result = verifyQaFreshness(snapshot, {
      content: 'Edited.', factsHash: 'facts-b', sampleHash: 'samples-b',
      language: 'de', mentionDecision: 'include', gateVersion: 'narrative-gate-v2',
    });
    expect(result.fresh).toBe(false);
    expect(result.reasons).toEqual(['content_changed', 'facts_changed', 'samples_changed', 'gate_changed']);
  });
});
