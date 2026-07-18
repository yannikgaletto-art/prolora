// GOAL-RUN8 T1.3 — the server, not the model, owns score bounds and buckets.
import { describe, expect, test } from 'vitest';
import { normalizeImpactScore } from '@/lib/scoring/score-service';
import { hashScoredContent } from '@/lib/scoring/content-hash';
import type { DeterministicResult } from '@/lib/scoring/deterministic';

const deterministic: DeterministicResult = {
  formatting_score: 20,
  platform_hygiene_score: 8,
  checks: [],
  body_links: ['https://example.com'],
  fold_text: 'Visible hook',
};

describe('normalizeImpactScore', () => {
  test('clamps model scores, limits improvements and derives the total', () => {
    const result = normalizeImpactScore(
      {
        hook_score: 38.7,
        structure_score: -4,
        detected_framework: 'relatable_enemy',
        improvements: ['Move the link.', 'Shorten the middle.', 'Clarify the proof.', 'Ignored.'],
        hook_rewrite: '  A sharper opening.  ',
      },
      deterministic
    );

    expect(result.score_breakdown).toEqual({
      hook: 30,
      structure: 0,
      formatting: 20,
      platform_hygiene: 8,
    });
    expect(result.virality_score).toBe(58);
    expect(result.traffic_light).toBe('yellow');
    expect(result.improvements).toEqual([
      'Move the link.',
      'Shorten the middle.',
      'Clarify the proof.',
    ]);
    expect(result.hook_rewrite).toBe('A sharper opening.');
  });

  test.each([
    [75, 'green'],
    [74, 'yellow'],
    [50, 'yellow'],
    [49, 'red'],
  ] as const)('maps total %s to %s', (total, expected) => {
    const fixed = total - deterministic.formatting_score - deterministic.platform_hygiene_score;
    const result = normalizeImpactScore(
      {
        hook_score: Math.min(30, fixed),
        structure_score: Math.max(0, fixed - 30),
        detected_framework: 'none',
        improvements: ['One.', 'Two.'],
      },
      deterministic
    );

    expect(result.virality_score).toBe(total);
    expect(result.traffic_light).toBe(expected);
  });
});

describe('hashScoredContent', () => {
  test('normalizes outer whitespace and CRLF before hashing', () => {
    expect(hashScoredContent('  Hook\r\n\r\nBody  ')).toBe(hashScoredContent('Hook\n\nBody'));
    expect(hashScoredContent('Hook\nBody changed')).not.toBe(hashScoredContent('Hook\nBody'));
  });
});
