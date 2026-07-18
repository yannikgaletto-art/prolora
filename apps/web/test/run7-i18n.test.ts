import { describe, expect, it } from 'vitest';
import { getRun7Dict } from '../lib/i18n/run7';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

describe('Run 7 chrome localization', () => {
  it('has the same complete key set in German, English and Spanish', () => {
    const keys = leafKeys(getRun7Dict('de')).sort();
    expect(keys.length).toBeGreaterThanOrEqual(45);
    expect(leafKeys(getRun7Dict('en')).sort()).toEqual(keys);
    expect(leafKeys(getRun7Dict('es')).sort()).toEqual(keys);
  });

  it('translates representative Composer, Connections, Listen and status strings', () => {
    const de = getRun7Dict('de');
    const en = getRun7Dict('en');
    const es = getRun7Dict('es');
    for (const key of [
      [de.composer.dictate, en.composer.dictate, es.composer.dictate],
      [de.media.generate, en.media.generate, es.media.generate],
      [de.connections.available, en.connections.available, es.connections.available],
      [de.listen.widgetConnected, en.listen.widgetConnected, es.listen.widgetConnected],
      [de.system.title, en.system.title, es.system.title],
    ]) {
      expect(new Set(key).size).toBe(3);
    }
  });
});
