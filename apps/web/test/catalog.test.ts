// Oracle O7: catalog data contract — every slot self-explanatory (question +
// help + example + kind), every template carries an honest strategy block.
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATALOG, getTemplateById } from '@/lib/templates/catalog';

const SLOT_KINDS = ['fact', 'erfahrung', 'angle'] as const;
const AUFWAND = ['niedrig', 'mittel', 'hoch'] as const;
const POST_TYPES = [
  'value_edu',
  'product_demo',
  'review',
  'unboxing',
  'tutorial',
  'transformation',
  'build_in_public',
  'lifestyle',
  'community_fomo',
  'crowdsourcing',
] as const;

describe('catalog shape', () => {
  it('has 14 templates with unique ids', () => {
    expect(TEMPLATE_CATALOG).toHaveLength(14);
    const ids = TEMPLATE_CATALOG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all ten post types', () => {
    const covered = new Set(TEMPLATE_CATALOG.map((t) => t.post_type));
    for (const postType of POST_TYPES) {
      expect(covered.has(postType), postType).toBe(true);
    }
  });

  it('every template has 1–4 slots, anlass keys, hooks and prompt hints', () => {
    for (const template of TEMPLATE_CATALOG) {
      expect(template.slots.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.slots.length, template.id).toBeLessThanOrEqual(4);
      expect(template.anlass_keys.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.hook_formulas.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.prompt_hints.length, template.id).toBeGreaterThan(0);
      expect(template.recommended_platforms.length, template.id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('slots (O7 — user feedback #4: every question understandable)', () => {
  it('the catalog has exactly 52 slots in total', () => {
    const total = TEMPLATE_CATALOG.reduce((sum, t) => sum + t.slots.length, 0);
    expect(total).toBe(52);
  });

  it('every slot carries question, help, example and a valid kind', () => {
    for (const template of TEMPLATE_CATALOG) {
      for (const slot of template.slots) {
        const where = `${template.id}.${slot.key}`;
        expect(slot.question.length, where).toBeGreaterThan(0);
        expect(slot.help.length, where).toBeGreaterThan(0);
        expect(slot.example.length, where).toBeGreaterThan(0);
        expect(SLOT_KINDS, where).toContain(slot.kind);
      }
    }
  });

  it('slot keys are unique within each template', () => {
    for (const template of TEMPLATE_CATALOG) {
      const keys = template.slots.map((s) => s.key);
      expect(new Set(keys).size, template.id).toBe(keys.length);
    }
  });
});

describe('strategy blocks (user feedback #6)', () => {
  it('every template explains Ziel, 3× Warum, Benchmarks mit Quelle, Aufwand, Frequenz', () => {
    for (const template of TEMPLATE_CATALOG) {
      const s = template.strategy;
      expect(s.ziel.length, template.id).toBeGreaterThan(0);
      expect(s.warum, template.id).toHaveLength(3);
      for (const line of s.warum) expect(line.length, template.id).toBeGreaterThan(20);
      expect(s.benchmarks.length, template.id).toBeGreaterThanOrEqual(1);
      for (const benchmark of s.benchmarks) {
        expect(benchmark.metrik.length, template.id).toBeGreaterThan(0);
        expect(benchmark.wert.length, template.id).toBeGreaterThan(0);
        // Honest benchmarks: a source label is mandatory, never a bare claim.
        expect(benchmark.quelle.length, template.id).toBeGreaterThan(0);
      }
      expect(AUFWAND, template.id).toContain(s.aufwand);
      expect(s.frequenz.length, template.id).toBeGreaterThan(0);
    }
  });
});

describe('getTemplateById', () => {
  it('resolves every catalog id and rejects unknown ids', () => {
    for (const template of TEMPLATE_CATALOG) {
      expect(getTemplateById(template.id)?.id).toBe(template.id);
    }
    expect(getTemplateById('gibts-nicht')).toBeUndefined();
  });
});
