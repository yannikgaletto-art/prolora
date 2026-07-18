// GOAL-RUN8 T1.2 — exact fixtures for the zero-credit scoring layer.
import { describe, expect, test } from 'vitest';
import {
  FOLD_LIMITS,
  runDeterministicChecks,
} from '@/lib/scoring/deterministic';

describe('runDeterministicChecks', () => {
  test('gives a concise Welsh-style post full deterministic points', () => {
    const content = [
      'Most teams do not need more content.',
      '',
      'They need one useful idea.',
      '',
      'Then they need to repeat it clearly.',
    ].join('\n');

    const result = runDeterministicChecks(content, 'linkedin');

    expect(result.formatting_score).toBe(20);
    expect(result.platform_hygiene_score).toBe(20);
  });

  test('penalizes a 900-character text wall', () => {
    const content = 'Dense writing without a pause '.repeat(35).slice(0, 900);

    const result = runDeterministicChecks(content, 'linkedin');

    expect(result.formatting_score).toBeLessThanOrEqual(6);
  });

  test('penalizes a body link without a first comment', () => {
    const result = runDeterministicChecks(
      'The full guide is here: https://example.com/guide',
      'linkedin'
    );

    expect(result.platform_hygiene_score).toBeLessThanOrEqual(8);
    expect(result.body_links).toEqual(['https://example.com/guide']);
  });

  test('keeps hygiene points when the link is in the first comment', () => {
    const result = runDeterministicChecks('The full guide is ready.', 'linkedin', {
      firstComment: 'Read it here: https://example.com/guide',
    });

    expect(result.platform_hygiene_score).toBeGreaterThanOrEqual(18);
    expect(result.body_links).toEqual([]);
  });

  test('fails the character-limit check for a 300-character X post', () => {
    const result = runDeterministicChecks('x'.repeat(300), 'x');
    const lengthCheck = result.checks.find((check) => check.id === 'character_limit');

    expect(lengthCheck?.passed).toBe(false);
  });

  test('returns zero scores and failed checks for blank content', () => {
    const result = runDeterministicChecks('  \n ', 'linkedin');

    expect(result.formatting_score).toBe(0);
    expect(result.platform_hygiene_score).toBe(0);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.every((check) => check.passed === false)).toBe(true);
  });

  test('cuts the LinkedIn fold preview at a word boundary', () => {
    const content = 'A practical sentence with normal word boundaries. '.repeat(12);

    const result = runDeterministicChecks(content, 'linkedin');

    expect(result.fold_text.length).toBeLessThanOrEqual(FOLD_LIMITS.linkedin!);
    expect(result.fold_text.endsWith(' ')).toBe(false);
    expect(content[result.fold_text.length]).toMatch(/\s/);
  });
});
