// Oracle O9: the three dictionaries stay in lockstep — a key added to one
// locale must exist (non-empty) in all of them; locale resolution degrades
// to 'de' (DACH default), never crashes.
import { describe, expect, it } from 'vitest';
import { fill, getDict, isAppLocale, parseAcceptLanguage, APP_LOCALES } from '@/lib/i18n';
import { de } from '@/lib/i18n/de';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';

describe('dictionaries (O9)', () => {
  it('de/en/es expose identical key sets', () => {
    const deKeys = Object.keys(de).sort();
    expect(Object.keys(en).sort()).toEqual(deKeys);
    expect(Object.keys(es).sort()).toEqual(deKeys);
  });

  it('every value is a non-empty string in every locale', () => {
    for (const [locale, dict] of Object.entries({ de, en, es })) {
      for (const [key, value] of Object.entries(dict)) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('getDict returns the matching dictionary for each locale', () => {
    expect(getDict('de')).toBe(de);
    expect(getDict('en')).toBe(en);
    expect(getDict('es')).toBe(es);
  });

  it('interpolation keys stay consistent (step_of needs current/total)', () => {
    for (const locale of APP_LOCALES) {
      const dict = getDict(locale);
      expect(dict.step_of).toContain('{current}');
      expect(dict.step_of).toContain('{total}');
      expect(dict.missing_slot_error).toContain('{question}');
    }
  });
});

describe('locale resolution', () => {
  it('isAppLocale accepts exactly de/en/es', () => {
    expect(isAppLocale('de')).toBe(true);
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('es')).toBe(true);
    expect(isAppLocale('fr')).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
    expect(isAppLocale(null)).toBe(false);
  });

  it('parseAcceptLanguage picks the first supported language', () => {
    expect(parseAcceptLanguage('en-US,en;q=0.9,de;q=0.8')).toBe('en');
    expect(parseAcceptLanguage('es-MX,es;q=0.9')).toBe('es');
    expect(parseAcceptLanguage('fr-FR,it;q=0.9,es;q=0.5')).toBe('es');
    expect(parseAcceptLanguage('fr-FR,it;q=0.9')).toBe('de');
    expect(parseAcceptLanguage('')).toBe('de');
    expect(parseAcceptLanguage(null)).toBe('de');
    expect(parseAcceptLanguage(undefined)).toBe('de');
  });
});

describe('fill', () => {
  it('replaces known placeholders and leaves unknown ones intact', () => {
    expect(fill('Schritt {current} von {total}', { current: 2, total: 4 })).toBe(
      'Schritt 2 von 4'
    );
    expect(fill('Bitte beantworte: „{question}"', { question: 'Was?' })).toBe(
      'Bitte beantworte: „Was?"'
    );
    expect(fill('{a} und {b}', { a: 'x' })).toBe('x und {b}');
  });
});
