import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATALOG } from '../lib/templates/catalog';
import { localizeCatalog, localizedAnlaesseForGoal, localizedIntentInfo } from '../lib/templates/localization';

describe('template catalog localization', () => {
  for (const locale of ['en', 'es'] as const) {
    it(`localizes every visible catalog field to ${locale}`, () => {
      const localized = localizeCatalog(TEMPLATE_CATALOG, locale);
      expect(localized).toHaveLength(TEMPLATE_CATALOG.length);
      localized.forEach((template, index) => {
        expect(template.name).not.toBe(TEMPLATE_CATALOG[index]?.name);
        expect(template.description).not.toBe(TEMPLATE_CATALOG[index]?.description);
        template.slots.forEach((slot, slotIndex) => {
          expect(slot.question).not.toBe(TEMPLATE_CATALOG[index]?.slots[slotIndex]?.question);
          expect(slot.help).not.toBe(TEMPLATE_CATALOG[index]?.slots[slotIndex]?.help);
          expect(slot.example.trim().length).toBeGreaterThan(0);
        });
      });
      expect(localizedIntentInfo(locale)).toHaveLength(5);
      expect(localizedAnlaesseForGoal(TEMPLATE_CATALOG, 'value', locale).length).toBeGreaterThan(0);
    });
  }

  it('preserves the German catalog as the fallback', () => {
    expect(localizeCatalog(TEMPLATE_CATALOG, 'de')).toBe(TEMPLATE_CATALOG);
  });

  it('preserves field-specific meaning instead of substituting generic guidance', () => {
    const en = localizeCatalog(TEMPLATE_CATALOG, 'en');
    const es = localizeCatalog(TEMPLATE_CATALOG, 'es');
    expect(en[0]?.slots[0]).toMatchObject({
      question: expect.stringMatching(/what problem/i),
      help: expect.stringMatching(/narrower/i),
      example: expect.stringMatching(/social media posts/i),
    });
    expect(es[0]?.slots[0]).toMatchObject({
      question: expect.stringMatching(/qué problema/i),
      help: expect.stringMatching(/concreto|estrecho/i),
      example: expect.stringMatching(/redes sociales/i),
    });
    expect(en[0]?.strategy.ziel).toMatch(/authority/i);
    expect(es[0]?.strategy.ziel).toMatch(/autoridad/i);
    expect(en.find((template) => template.id === 'value-hormozi-carousel')?.manual_steps?.[0]).toMatch(/export slides as pdf/i);
  });
});
