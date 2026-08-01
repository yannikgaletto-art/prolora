import { describe, expect, test } from 'vitest';
import { runQualityGate, type GateInput } from '@/lib/pipeline/quality-gate';

const structure = {
  beweisbarer_ausgangspunkt: 'confirmed observation', bruch: 'but',
  unerwarteter_befund: 'unexpected', mechanismus: 'because', handlungsregel: 'do this',
};

const base: GateInput = {
  content: 'I learned something useful while building the product.',
  platform: 'linkedin', structure, proofAssets: [],
  thresholds: { deterministic: { minTotalScore: 0 } },
  narrative: {
    language: 'en',
    mention: { decision: 'omit', reason: 'not relevant', placement: null, confidence: 1, ruleIds: [] },
    facts: [], samples: [], semanticJudgeRequired: false,
  },
};

describe('Narrative Quality Gate', () => {
  test('blocks a language mismatch and unresolved placeholders', async () => {
    const language = await runQualityGate({ ...base, content: 'Ich habe beim Bauen etwas gelernt.' });
    expect(language.passed).toBe(false);
    expect(language.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'language', status: 'failed' }),
    ]));

    const placeholder = await runQualityGate({ ...base, content: 'I reached [X users] this week.' });
    expect(placeholder.passed).toBe(false);
    expect(placeholder.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'narrative_consistency', status: 'failed' }),
    ]));
  });

  test('blocks Pathly when the mention decision says omit', async () => {
    const result = await runQualityGate({ ...base, content: 'I learned this while building Pathly.' });
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'mention', status: 'failed', remedy: 'remove_mention' }),
    ]));
  });

  test('blocks verbatim sample copying but accepts a genuinely new angle', async () => {
    const copied = await runQualityGate({
      ...base,
      content: 'The signal I wanted to dismiss was exactly where I needed to look.',
      narrative: {
        ...base.narrative!,
        samples: [{ id: 'sample-1', maskedContent: 'The signal I wanted to dismiss was exactly where I needed to look.' }],
      },
    });
    expect(copied.passed).toBe(false);
    expect(copied.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'sample_copy', status: 'failed' }),
    ]));
  });

  test('a required semantic judge that did not run cannot pass', async () => {
    const result = await runQualityGate({
      ...base,
      narrative: { ...base.narrative!, semanticJudgeRequired: true },
    });
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'narrative_consistency', status: 'skipped', passed: false }),
    ]));
  });
});
