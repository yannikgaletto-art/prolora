import { describe, expect, test } from 'vitest';
import { matchReferences } from '@/lib/content/reference-matcher';
import { isVerifiedEngagement } from '@/lib/content/references';
import type { ContentReferenceRow } from '@/lib/db';

function ref(overrides: Partial<ContentReferenceRow>): ContentReferenceRow {
  return {
    id: 'ref-1',
    workspace_id: null,
    platform: 'reddit',
    source_url: null,
    author_name: null,
    published_at: null,
    engagement: null,
    reference_type: 'data_analysis',
    hook: 'Ich habe X analysiert',
    structure: {},
    why_it_worked: [],
    reusable_pattern: 'Analyse-Post',
    relevance_tags: ['analyse'],
    relevance_score: 50,
    verified_at: null,
    created_at: '2026-07-22T00:00:00Z',
    ...overrides,
  };
}

describe('reference matcher (GOAL-RUN9 T1.3)', () => {
  test('goal affinity beats curator score', () => {
    const analysis = ref({ id: 'a', reference_type: 'data_analysis', relevance_score: 40 });
    const strategy = ref({ id: 'b', reference_type: 'strategy_change', relevance_score: 95 });
    const result = matchReferences([analysis, strategy], 'authority', []);
    expect(result[0]?.reference.id).toBe('a');
  });

  test('goal tag match adds weight', () => {
    const tagged = ref({ id: 'a', relevance_tags: ['personalStory'], reference_type: 'framework' });
    const untagged = ref({ id: 'b', reference_type: 'framework' });
    const result = matchReferences([tagged, untagged], 'personalStory', []);
    expect(result[0]?.reference.id).toBe('a');
  });

  test('keyword overlap is capped and deterministic', () => {
    const a = ref({ id: 'a', relevance_tags: ['bewerbung', 'analyse', 'daten'] });
    const b = ref({ id: 'b' });
    const result = matchReferences([a, b], 'authority', ['Bewerbung', 'Daten']);
    expect(result[0]?.reference.id).toBe('a');
    // Same input -> same order (no randomness anywhere).
    const again = matchReferences([a, b], 'authority', ['Bewerbung', 'Daten']);
    expect(again.map((r) => r.reference.id)).toEqual(result.map((r) => r.reference.id));
  });

  test('respects the limit of 3', () => {
    const refs = ['a', 'b', 'c', 'd', 'e'].map((id) => ref({ id }));
    expect(matchReferences(refs, 'authority', []).length).toBeLessThanOrEqual(3);
  });
});

describe('engagement honesty invariant (D2/T1.2)', () => {
  test('unverified metrics are never surfaced', () => {
    expect(isVerifiedEngagement(ref({ engagement: { likesOrUpvotes: 12000 } }))).toBe(false);
    expect(isVerifiedEngagement(ref({ verified_at: '2026-07-22T00:00:00Z' }))).toBe(false);
    expect(
      isVerifiedEngagement(ref({ engagement: { likesOrUpvotes: null }, verified_at: '2026-07-22T00:00:00Z' }))
    ).toBe(false);
  });

  test('verified metrics pass', () => {
    expect(
      isVerifiedEngagement(
        ref({ engagement: { likesOrUpvotes: 12000 }, verified_at: '2026-07-22T00:00:00Z' })
      )
    ).toBe(true);
  });
});
