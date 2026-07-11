// Regression guard: the 0-credit scaffold path must keep RUN4 behavior —
// the wizard swap (GOAL-RUN5) reuses it unchanged.
import { describe, expect, it } from 'vitest';
import type { PostTemplate } from '@prolora/shared';
import { renderScaffold } from '@/lib/templates/scaffold';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';

function makeTemplate(overrides: Partial<PostTemplate> = {}): PostTemplate {
  return {
    id: 'test-template',
    name: 'Test',
    description: 'Testvorlage',
    intent: 'value',
    post_type: 'value_edu',
    psych_levels: ['rational'],
    structure: ['hook', 'kontext', 'ergebnis', 'cta'],
    hook_formulas: ['Ich habe [zahl] erreicht — so gehts.'],
    cta_mechanic: 'save_cta',
    style_preset: 'neutral',
    format: 'text',
    recommended_platforms: ['linkedin'],
    anlass_keys: ['zahl'],
    strategy: {
      ziel: 'Test',
      warum: ['a', 'b', 'c'],
      benchmarks: [{ metrik: 'm', wert: 'w', quelle: 'q' }],
      aufwand: 'niedrig',
      frequenz: '1×/Woche',
    },
    slots: [
      {
        key: 'zahl',
        question: 'Welche Zahl?',
        help: 'Eine echte Zahl.',
        example: '42',
        kind: 'fact',
        required: true,
      },
    ],
    prompt_hints: 'test',
    ...overrides,
  };
}

describe('renderScaffold', () => {
  it('fills [key] tokens in the hook with slot values', () => {
    const output = renderScaffold(makeTemplate(), { zahl: '42' });
    expect(output).toContain('Ich habe 42 erreicht — so gehts.');
  });

  it('leaves the token when the slot is empty and skips it in the answer list', () => {
    const output = renderScaffold(makeTemplate(), { zahl: '   ' });
    expect(output).toContain('[zahl]');
    expect(output).not.toContain('Deine Angaben:');
  });

  it('lays out structure slots as placeholders, excluding hook and cta', () => {
    const output = renderScaffold(makeTemplate(), {});
    expect(output).toContain('[Kontext: …]');
    expect(output).toContain('[Ergebnis: …]');
    expect(output).not.toContain('[Hook: …]');
    expect(output).not.toContain('[Cta: …]');
  });

  it('appends the CTA scaffold for the mechanic', () => {
    const output = renderScaffold(makeTemplate(), {});
    expect(output).toContain('Speichere den Post für [konkreter Anlass].');
  });

  it('lists answered slots under "Deine Angaben:"', () => {
    const output = renderScaffold(makeTemplate(), { zahl: '42' });
    expect(output).toContain('Deine Angaben:');
    expect(output).toContain('- Zahl: 42');
  });

  it('produces non-empty output for every real catalog template (smoke)', () => {
    for (const template of TEMPLATE_CATALOG) {
      const output = renderScaffold(template, {});
      expect(output.trim().length, template.id).toBeGreaterThan(0);
    }
  });
});
