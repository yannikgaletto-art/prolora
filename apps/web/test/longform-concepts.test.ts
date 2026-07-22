import { describe, expect, test } from 'vitest';
import type { PostTemplate, ProofAsset } from '@prolora/shared';
import { DEFAULT_CONCEPT_SETTINGS } from '@prolora/shared';
import { buildTemplatePrompt, LONGFORM_MIN_BUDGET } from '@/lib/templates/render-prompt';
import { truncateAtParagraph } from '@/lib/templates/draft-service';
import { missingLenses, settingsToPromptLines } from '@/lib/content/concept-service';
import { suggestAngles } from '@/lib/content/angle-service';

const longformTemplate: PostTemplate = {
  id: 'test-longform',
  name: 'Story',
  description: 'test',
  intent: 'personal_brand',
  post_type: 'transformation',
  psych_levels: ['emotional'],
  structure: ['hook', 'story', 'cta'],
  hook_formulas: ['Nach [zeit] habe ich [ergebnis].'],
  cta_mechanic: 'none',
  style_preset: 'abdaal_evidence',
  format: 'text',
  recommended_platforms: ['linkedin'],
  anlass_keys: [],
  strategy: {
    ziel: 'test',
    warum: ['a', 'b', 'c'],
    benchmarks: [{ metrik: 'm', wert: 'w', quelle: 'q' }],
    aufwand: 'niedrig',
    frequenz: 'test',
  },
  slots: [
    {
      key: 'geschichte',
      question: 'Erzähl, was passiert ist',
      help: '',
      example: '',
      kind: 'story',
      required: true,
    },
  ],
  prompt_hints: 'test',
  narrative: 'longform',
};

describe('longform prompt mode (GOAL-RUN9 D6)', () => {
  test('LinkedIn budget activates the narrative arc with a length floor', () => {
    const prompt = buildTemplatePrompt({
      template: longformTemplate,
      slots: { geschichte: 'Meine Geschichte' },
      targetPlatforms: ['linkedin'],
      context: null,
    });
    expect(prompt.lengthFloor).toBe(Math.floor(3000 * 0.6));
    expect(prompt.longformFallback).toBe(false);
    expect(prompt.system).toContain('Narrative arc');
    expect(prompt.system).toContain('ANTI-FABRICATION');
    expect(prompt.system).toContain('Length target');
  });

  test('X in the targets forces the punchy fallback (budget < 1500)', () => {
    const prompt = buildTemplatePrompt({
      template: longformTemplate,
      slots: { geschichte: 'Meine Geschichte' },
      targetPlatforms: ['linkedin', 'x'],
      context: null,
    });
    expect(prompt.characterBudget).toBeLessThan(LONGFORM_MIN_BUDGET);
    expect(prompt.lengthFloor).toBeNull();
    expect(prompt.longformFallback).toBe(true);
    expect(prompt.system).toContain('cannot hold a story');
    expect(prompt.system).not.toContain('Narrative arc');
  });

  test('non-longform templates keep the punchy structure rules', () => {
    const prompt = buildTemplatePrompt({
      template: { ...longformTemplate, narrative: undefined },
      slots: { geschichte: 'x' },
      targetPlatforms: ['linkedin'],
      context: null,
    });
    expect(prompt.lengthFloor).toBeNull();
    expect(prompt.system).toContain('Every sentence must earn its place');
  });
});

describe('over-budget truncation (T4.4 / Bestandsbug F15)', () => {
  test('cuts at the last paragraph boundary under budget', () => {
    const text = 'Absatz eins.\n\nAbsatz zwei ist etwas länger.\n\nAbsatz drei sprengt das Budget.';
    const result = truncateAtParagraph(text, 45, 'linkedin');
    expect(result).toBe('Absatz eins.\n\nAbsatz zwei ist etwas länger.');
    expect(result.length).toBeLessThanOrEqual(45);
  });

  test('falls back to a hard cut when even the first paragraph is too long', () => {
    const text = 'Ein einziger sehr langer Absatz ohne Umbrüche der das Budget klar überschreitet.';
    const result = truncateAtParagraph(text, 20, 'linkedin');
    expect(result.length).toBe(20);
  });

  test('returns unchanged text when under budget', () => {
    expect(truncateAtParagraph('kurz', 100, 'linkedin')).toBe('kurz');
  });
});

describe('concept lens invariant (D5)', () => {
  test('detects missing lenses', () => {
    expect(missingLenses([{ lens: 'evidence' }, { lens: 'founder' }])).toEqual(['community']);
    expect(
      missingLenses([{ lens: 'evidence' }, { lens: 'founder' }, { lens: 'community' }])
    ).toEqual([]);
  });
});

describe('gear settings → prompt (T2.3)', () => {
  test('defaults produce the D8 lines', () => {
    const lines = settingsToPromptLines(DEFAULT_CONCEPT_SETTINGS).join('\n');
    expect(lines).toContain('700–1300');
    expect(lines).toContain('Value density 4/5');
    expect(lines).toContain('Community commitment 3/5');
    expect(lines).toContain('Vulnerability 3/5');
    expect(lines).toContain('Tone: reflective');
    expect(lines).toContain('Include real numbers');
    expect(lines).toContain('No CTA');
  });

  test('every dial changes the prompt', () => {
    const base = settingsToPromptLines(DEFAULT_CONCEPT_SETTINGS).join('\n');
    const changed = settingsToPromptLines({
      valueDensity: 1,
      length: 'long',
      communityCommitment: 5,
      vulnerability: 5,
      tone: 'provocative',
      includeData: false,
      includeFramework: false,
      includeCTA: true,
    }).join('\n');
    expect(changed).not.toBe(base);
    expect(changed).toContain('1300–2300');
    expect(changed).toContain('counter-arguments');
    expect(changed).toContain('CTA');
  });
});

describe('deterministic angle suggestions (T2.2 — 0 credits)', () => {
  const proof: ProofAsset = {
    id: 'p1',
    type: 'metric',
    content: 'Ich habe 1.200 Stellenanzeigen analysiert',
    source_url: null,
    verified_at: null,
    created_at: '2026-07-22T00:00:00Z',
  };

  test('returns exactly the three lenses, grounded in proof assets', () => {
    const angles = suggestAngles({
      goal: 'authority',
      productDescription: 'KI-gestützte Bewerbungsplattform',
      coreValue: ['Weniger manueller Bewerbungsaufwand'],
      proofAssets: [proof],
      references: [],
    });
    expect(angles.map((angle) => angle.lens)).toEqual(['evidence', 'founder', 'community']);
    expect(angles[0]?.title).toContain('1.200 Stellenanzeigen');
  });

  test('works without any profile data (honest empty framing)', () => {
    const angles = suggestAngles({
      goal: 'community',
      productDescription: null,
      coreValue: [],
      proofAssets: [],
      references: [],
    });
    expect(angles).toHaveLength(3);
    expect(angles[0]?.why_this_fits).toContain('ProofAsset');
  });
});
