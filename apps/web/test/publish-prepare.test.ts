// GOAL-RUN11 One Path — pure parts of the prepare composition plus the D6
// coverage de-dramatization. IO orchestration itself is not tested here
// (matches the repo style: pure logic with vitest, edges mocked or skipped).
import { describe, expect, it } from 'vitest';
import type { PostConcept } from '@prolora/shared';
import { derivePlatforms, pickBestConcept } from '@/lib/publish/prepare';
import { coverageTone } from '@/app/(dashboard)/publish/pipeline/cockpit-logic';
import { suggestAngles } from '@/lib/content/angle-service';
import { ANTI_AI_MARKER_RULES, VALUE_FORMATS } from '@/lib/templates/render-prompt';

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

describe('suggestAngles material diversity (RUN11 feedback 17.08.)', () => {
  const singleProof = {
    id: 'p1',
    type: 'metric' as const,
    content: 'Pathly-Nutzer landen 26 % öfter im Job-Interview als vergleichbar Qualifizierte.',
    source_url: null,
    verified_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
  };

  it('never opens two cards with the same material when only one proof asset exists', () => {
    const angles = suggestAngles({
      goal: 'authority',
      productDescription: 'Pathly — KI-Bewerbungscoach',
      coreValue: ['Schneller zum Interview'],
      proofAssets: [singleProof],
      references: [],
      founderPerspective: 'Ich glaube, Anschreiben sind das falsche Optimierungsziel.',
    });
    const openings = angles.map((angle) => angle.title.slice(0, 40));
    expect(new Set(openings).size).toBe(3);
    // Der eine Beleg gehört der Evidence-Karte; die anderen ziehen anderes Material.
    expect(angles[0].title).toContain('26');
    expect(angles[1].title).not.toContain('26');
    expect(angles[2].title).not.toContain('26');
  });

  it('titles read as hooks, not meta prose', () => {
    const angles = suggestAngles({
      goal: 'authority',
      productDescription: null,
      coreValue: [],
      proofAssets: [singleProof],
      references: [],
    });
    for (const angle of angles) {
      expect(angle.title).not.toMatch(/^Deine Zahl als Story|^Founder-Einblick:/);
    }
  });
});

describe('anti-AI marker rules (Regelwerk §7, 17.08.)', () => {
  const rules = ANTI_AI_MARKER_RULES.join('\n');

  it('bans the classic AI tells the user flagged', () => {
    expect(rules).toContain('nicht nur X, sondern Y');
    expect(rules).toContain('negation enumerations');
    expect(rules).toContain('Das fühlt sich X an. Und das ist es auch.');
    expect(rules).toContain('em-dashes');
  });

  it('demands friend-register and short sentences', () => {
    expect(rules).toContain('voice message to a friend');
    expect(rules).toMatch(/max ~15 words/);
  });

  it('ships the value formats the user asked for', () => {
    const formats = VALUE_FORMATS.join('\n');
    for (const needle of ['Tipps & Tricks', 'Experience story', 'Wendung', 'Myth-busting', 'Vorher/Nachher', 'Behind the scenes']) {
      expect(formats).toContain(needle);
    }
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
