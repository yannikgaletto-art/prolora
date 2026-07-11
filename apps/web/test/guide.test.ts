// Oracle O6 (verschärft): the guide layer must never offer a dead end or a
// Scheinentscheidung — executable against the real catalog.
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATALOG } from '@/lib/templates/catalog';
import {
  ANLASS_INFO,
  INTENT_INFO,
  anlaesseForGoal,
  anlassByKey,
  guideInvariantViolations,
  intentByKey,
  stepPlanFor,
  templatesFor,
  type GuideTemplate,
} from '@/lib/templates/guide';

describe('guide invariants (O6)', () => {
  it('the real catalog has zero invariant violations', () => {
    expect(guideInvariantViolations(TEMPLATE_CATALOG)).toEqual([]);
  });

  it('every goal offers at least two real paths', () => {
    for (const intent of INTENT_INFO) {
      const anlaesse = anlaesseForGoal(TEMPLATE_CATALOG, intent.key);
      expect(anlaesse.length, `Ziel ${intent.key}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every offered goal × anlass combination yields at least one template', () => {
    for (const intent of INTENT_INFO) {
      for (const anlass of anlaesseForGoal(TEMPLATE_CATALOG, intent.key)) {
        const matching = templatesFor(TEMPLATE_CATALOG, intent.key, anlass.key);
        expect(matching.length, `${intent.key} × ${anlass.key}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('detects a broken catalog (unknown anlass, dead end, Scheinentscheidung)', () => {
    const broken: GuideTemplate[] = [
      { id: 'a', intent: 'value', anlass_keys: ['gibtsnicht'] },
      { id: 'b', intent: 'value', anlass_keys: ['zahl', 'wip'] },
      { id: 'c', intent: 'product', anlass_keys: [] },
    ];
    const violations = guideInvariantViolations(broken);
    expect(violations.some((v) => v.includes('unbekannten Anlass'))).toBe(true);
    expect(violations.some((v) => v.includes('keine anlass_keys'))).toBe(true);
    expect(violations.some((v) => v.includes('Scheinentscheidung'))).toBe(true);
  });
});

describe('guide content (user feedback #3)', () => {
  it('all five intents carry exactly three explanation bullets', () => {
    expect(INTENT_INFO).toHaveLength(5);
    for (const intent of INTENT_INFO) {
      expect(intent.bullets).toHaveLength(3);
      expect(intent.label.length).toBeGreaterThan(0);
      expect(intent.satz.length).toBeGreaterThan(0);
      expect(intent.wann.length).toBeGreaterThan(0);
      for (const bullet of intent.bullets) expect(bullet.length).toBeGreaterThan(20);
    }
  });

  it('every anlass has label, beschreibung and beispiel', () => {
    for (const anlass of ANLASS_INFO) {
      expect(anlass.label.length).toBeGreaterThan(0);
      expect(anlass.beschreibung.length).toBeGreaterThan(0);
      expect(anlass.beispiel.length).toBeGreaterThan(0);
    }
  });

  it('lookup helpers resolve known keys and reject unknown ones', () => {
    expect(intentByKey('value')?.key).toBe('value');
    expect(intentByKey('quatsch')).toBeUndefined();
    expect(anlassByKey('zahl')?.key).toBe('zahl');
    expect(anlassByKey('quatsch')).toBeUndefined();
  });
});

describe('stepPlanFor (adaptive skips, T2)', () => {
  it('skips the anlass step when a goal has exactly one anlass', () => {
    const synthetic: GuideTemplate[] = [
      { id: 'only', intent: 'value', anlass_keys: ['zahl'] },
      { id: 'other', intent: 'value', anlass_keys: ['zahl'] },
    ];
    const plan = stepPlanFor(synthetic, 'value');
    expect(plan.skipAnlass).toBe(true);
    expect(plan.soleAnlassKey).toBe('zahl');
  });

  it('auto-expands the single template of a combination', () => {
    const synthetic: GuideTemplate[] = [
      { id: 'solo', intent: 'value', anlass_keys: ['zahl'] },
      { id: 'pair', intent: 'value', anlass_keys: ['wip'] },
    ];
    const plan = stepPlanFor(synthetic, 'value', 'zahl');
    expect(plan.autoExpandTemplateId).toBe('solo');
  });

  it('never skips the anlass step in the real catalog (curation guarantees ≥ 2)', () => {
    for (const intent of INTENT_INFO) {
      expect(stepPlanFor(TEMPLATE_CATALOG, intent.key).skipAnlass).toBe(false);
    }
  });
});
