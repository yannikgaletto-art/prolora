// GOAL-RUN11 One Path — pure parts of the prepare composition plus the D6
// coverage de-dramatization. IO orchestration itself is not tested here
// (matches the repo style: pure logic with vitest, edges mocked or skipped).
import { describe, expect, it } from 'vitest';
import type { PostConcept } from '@prolora/shared';
import { derivePlatforms, pickBestConcept } from '@/lib/publish/prepare';
import { coverageTone } from '@/app/(dashboard)/publish/pipeline/cockpit-logic';

function concept(overrides: Partial<PostConcept>): PostConcept {
  return {
    lens: 'evidence',
    title: 't',
    angle: 'a',
    structure_label: 's',
    canonical_content: 'c',
    rationale: 'r',
    based_on_reference_ids: [],
    risk_flag: 'low',
    ...overrides,
  };
}

describe('derivePlatforms', () => {
  it('collects unique platforms of active connections', () => {
    expect(
      derivePlatforms([
        { platform: 'linkedin', status: 'active' },
        { platform: 'linkedin', status: 'active' },
        { platform: 'x', status: 'active' },
      ])
    ).toEqual(expect.arrayContaining(['linkedin', 'x']));
  });

  it('ignores inactive connections and platforms the concept pipeline cannot write for', () => {
    expect(
      derivePlatforms([
        { platform: 'x', status: 'expired' },
        { platform: 'devto', status: 'active' },
      ])
    ).toEqual(['linkedin']);
  });

  it('falls back to linkedin with no connections at all', () => {
    expect(derivePlatforms([])).toEqual(['linkedin']);
  });
});

describe('pickBestConcept', () => {
  it('prefers the lowest risk flag', () => {
    const best = pickBestConcept([
      concept({ lens: 'founder', risk_flag: 'medium' }),
      concept({ lens: 'community', risk_flag: 'low' }),
      concept({ lens: 'evidence', risk_flag: 'high' }),
    ]);
    expect(best?.lens).toBe('community');
  });

  it('keeps the service order on ties', () => {
    const best = pickBestConcept([
      concept({ lens: 'evidence', risk_flag: 'low' }),
      concept({ lens: 'founder', risk_flag: 'low' }),
    ]);
    expect(best?.lens).toBe('evidence');
  });

  it('returns null for an empty concept list (follow-up round)', () => {
    expect(pickBestConcept([])).toBeNull();
  });
});

describe('coverageTone (D6 de-dramatization)', () => {
  it('stays red below 3 days while the factory has work', () => {
    expect(coverageTone(1, true)).toBe('red');
  });

  it('goes gray instead of red on an empty factory', () => {
    expect(coverageTone(0, false)).toBe('gray');
  });

  it('keeps the pre-RUN11 behavior when hasWork is omitted', () => {
    expect(coverageTone(1)).toBe('red');
    expect(coverageTone(10)).toBe('green');
  });
});
