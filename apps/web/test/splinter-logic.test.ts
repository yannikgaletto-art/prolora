// GOAL-RUN6 §12 — pure splinter-engine logic: structural template diversity,
// tolerant LLM-output parsing (R3: untrusted input), and the Welsh spread
// (same core idea never on consecutive days when avoidable).
import { describe, expect, test } from 'vitest';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import {
  pickSplinterTemplates,
  parseSplinterOutput,
  assignDayOffsets,
} from '@/lib/content/splinter';

describe('pickSplinterTemplates', () => {
  test('picks 3-4 structurally different templates for a full platform set', () => {
    const picked = pickSplinterTemplates(['linkedin', 'x', 'bluesky', 'mastodon', 'telegram']);
    expect(picked.length).toBeGreaterThanOrEqual(3);
    expect(picked.length).toBeLessThanOrEqual(4);
    // Structural diversity: no duplicate format+style family.
    const families = picked.map((t) => `${t.format}:${t.style_preset}`);
    expect(new Set(families).size).toBe(families.length);
  });

  test('only offers templates reachable from the active platforms', () => {
    const picked = pickSplinterTemplates(['mastodon']);
    for (const t of picked) {
      expect(t.recommended_platforms).toContain('mastodon');
    }
  });

  test('falls back to the full catalog when nothing matches', () => {
    // Empty active set: reachable = [] -> pool = catalog, still >= 3 picks.
    const picked = pickSplinterTemplates([]);
    expect(picked.length).toBeGreaterThanOrEqual(3);
  });

  test('is deterministic', () => {
    const a = pickSplinterTemplates(['linkedin', 'x']).map((t) => t.id);
    const b = pickSplinterTemplates(['linkedin', 'x']).map((t) => t.id);
    expect(a).toEqual(b);
  });

  test('prioritizes the preferred style without removing structural variety', () => {
    const catalog = [
      { ...TEMPLATE_CATALOG[0], id: 'neutral', style_preset: 'neutral' as const },
      { ...TEMPLATE_CATALOG[1], id: 'pia', style_preset: 'koe_pia' as const },
      { ...TEMPLATE_CATALOG[2], id: 'evidence', style_preset: 'abdaal_evidence' as const },
      { ...TEMPLATE_CATALOG[3], id: 'welsh', style_preset: 'welsh_short' as const },
    ];
    const picked = pickSplinterTemplates(['linkedin'], catalog, 'koe_pia');
    expect(picked[0]?.id).toBe('pia');
    expect(picked.length).toBeGreaterThanOrEqual(3);
  });
});

describe('parseSplinterOutput', () => {
  const templates = TEMPLATE_CATALOG.slice(0, 2);
  const platforms = ['linkedin', 'x'] as const;

  test('parses a valid tool output and labels frameworks', () => {
    const parsed = parseSplinterOutput(
      {
        core_ideas: ['Idee A', 'Idee B', 'Idee C'],
        splinters: [
          {
            template_id: templates[0].id,
            platform: 'linkedin',
            framework_4a: 'analytical',
            pia_note: 'Pain: X. Insight: Y. Action: Z.',
            core_idea_index: 1,
            hook: 'Der Hook',
            content: 'Der Post-Inhalt',
          },
        ],
      },
      templates,
      [...platforms]
    );
    expect(parsed.core_ideas).toHaveLength(3);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0].framework_4a).toBe('analytical');
    expect(parsed.suggestions[0].format_label).toBe(templates[0].name);
  });

  test('drops malformed splinters with a warning instead of crashing', () => {
    const parsed = parseSplinterOutput(
      {
        core_ideas: ['Idee A'],
        splinters: [
          { platform: 'linkedin', framework_4a: 'actionable', pia_note: '', core_idea_index: 0, hook: 'H', content: 'C' },
          { platform: 'tiktok', hook: 'H', content: 'C' }, // unknown platform -> dropped
          'garbage',
          { platform: 'x', framework_4a: 'nonsense', pia_note: '', core_idea_index: 99, hook: 'H2', content: 'C2' },
        ],
      },
      templates,
      [...platforms]
    );
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(1);
    // Invalid framework falls back to 'actionable', out-of-range idea to 0.
    expect(parsed.suggestions[1].framework_4a).toBe('actionable');
    expect(parsed.suggestions[1].core_idea_index).toBe(0);
  });

  test('throws when nothing usable comes back', () => {
    expect(() => parseSplinterOutput({ core_ideas: [], splinters: [] }, templates, [...platforms])).toThrow();
    expect(() =>
      parseSplinterOutput({ core_ideas: ['A'], splinters: [{ platform: 'linkedin' }] }, templates, [...platforms])
    ).toThrow();
  });
});

describe('assignDayOffsets', () => {
  test('spreads one splinter per day', () => {
    const offsets = assignDayOffsets([
      { core_idea_index: 0 },
      { core_idea_index: 1 },
      { core_idea_index: 2 },
    ]);
    expect(offsets).toEqual([0, 1, 2]);
  });

  test('puts distance between consecutive same-idea variants', () => {
    const offsets = assignDayOffsets([
      { core_idea_index: 0 },
      { core_idea_index: 0 }, // same idea back-to-back -> +2 gap
      { core_idea_index: 1 },
    ]);
    expect(offsets[1] - offsets[0]).toBeGreaterThanOrEqual(2);
    expect(offsets[2]).toBeGreaterThan(offsets[1]);
  });
});
