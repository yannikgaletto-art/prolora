// Darstellungslogik des Tages-Cockpits (Plan 2 / 2B.5).
//
// Zwei Dinge müssen hier stimmen, sonst ist die Diagnose in der UI wertlos:
// die markierte Textstelle (`span` aus Vertrag C4) und die Unterscheidung
// zwischen "bestanden" und "übersprungen".
import { describe, expect, test } from 'vitest';
import {
  coverageTone,
  findingTone,
  primaryRemedy,
  provenanceChain,
  splitBySpan,
  STATE_TONES,
} from '@/app/(dashboard)/publish/pipeline/cockpit-logic';
import { getPipelineCopy, fillCopy } from '@/app/(dashboard)/publish/pipeline/copy';
import { CONTENT_ITEM_STATES } from '@/lib/pipeline/state';
import type { GateFinding } from '@/lib/pipeline/quality-gate';

function finding(partial: Partial<GateFinding>): GateFinding {
  return {
    check: 'proof_binding',
    passed: false,
    message: '',
    remedy: null,
    span: null,
    status: 'failed',
    ...partial,
  };
}

describe('Inline-Markierung der Fundstelle', () => {
  test('der Text wird exakt an der Fundstelle zerlegt', () => {
    const text = 'Die Ticketlast sank um 47 %.';
    const start = text.indexOf('47');
    const parts = splitBySpan(text, { start, end: start + 4 });
    expect(parts.before).toBe('Die Ticketlast sank um ');
    expect(parts.marked).toBe('47 %');
    expect(parts.after).toBe('.');
    expect(parts.before + parts.marked + parts.after).toBe(text);
  });

  test('ohne Span bleibt der Text unverändert', () => {
    const parts = splitBySpan('Ein Text ohne Befund.', null);
    expect(parts.marked).toBe('');
    expect(parts.before).toBe('Ein Text ohne Befund.');
  });

  test('ein Span über die Textlänge hinaus wird geklemmt statt zu crashen', () => {
    const parts = splitBySpan('kurz', { start: 2, end: 999 });
    expect(parts.before).toBe('ku');
    expect(parts.marked).toBe('rz');
    expect(parts.after).toBe('');
  });

  test('ein leerer Span markiert nichts', () => {
    expect(splitBySpan('abc', { start: 1, end: 1 }).marked).toBe('');
  });
});

describe('Herkunfts-Kette', () => {
  const copy = getPipelineCopy('de');

  test('"Aus 23 Feedbacks → 1 Beleg" wird sichtbar', () => {
    const chain = provenanceChain(
      {
        feedbackItemIds: Array.from({ length: 23 }, (_, i) => `f${i}`),
        proofAssetIds: ['p1'],
        communityIds: [],
        referenceIds: [],
      },
      copy
    );
    expect(chain).toEqual(['23 Feedback', '1 Beleg']);
  });

  test('ohne Evidenz bleibt die Kette leer — und wird nicht erfunden', () => {
    expect(
      provenanceChain(
        { feedbackItemIds: [], proofAssetIds: [], communityIds: [], referenceIds: [] },
        copy
      )
    ).toEqual([]);
  });
});

describe('Reichweiten-Ampel', () => {
  test('warnt, bevor die Kadenz einbricht', () => {
    expect(coverageTone(1)).toBe('red');
    expect(coverageTone(5)).toBe('amber');
    expect(coverageTone(12)).toBe('green');
  });

  test('unbekannte Reichweite ist grau, nicht grün', () => {
    expect(coverageTone(null)).toBe('gray');
  });
});

describe('Befund-Darstellung', () => {
  test('übersprungen ist grau, nicht grün', () => {
    expect(findingTone(finding({ status: 'skipped', passed: false }))).toBe('gray');
    expect(findingTone(finding({ status: 'passed', passed: true }))).toBe('green');
    expect(findingTone(finding({ status: 'failed' }))).toBe('red');
  });

  test('die erste Reparatur mit konkretem nächsten Schritt gewinnt', () => {
    const findings = [
      finding({ check: 'structure', status: 'failed', remedy: null }),
      finding({ check: 'proof_binding', status: 'failed', remedy: 'add_proof' }),
    ];
    expect(primaryRemedy(findings)?.remedy).toBe('add_proof');
  });

  test('ohne blockierenden Befund gibt es keine Reparatur-Aktion', () => {
    expect(primaryRemedy([finding({ status: 'passed', passed: true, remedy: null })])).toBeNull();
  });
});

describe('Copy ist für alle drei Sprachen vollständig', () => {
  test('jede Sprache kennt jeden Zustand', () => {
    for (const locale of ['de', 'en', 'es'] as const) {
      const copy = getPipelineCopy(locale);
      for (const state of CONTENT_ITEM_STATES) {
        expect(copy.states[state], `${locale}/${state}`).toBeTruthy();
        expect(STATE_TONES[state], state).toBeTruthy();
      }
      for (const check of ['proof_binding', 'structure', 'deterministic', 'self_similarity'] as const) {
        expect(copy.checks[check], `${locale}/${check}`).toBeTruthy();
      }
      for (const remedy of ['add_proof', 'rewrite_structure', 'shorten', 'differentiate'] as const) {
        expect(copy.remedies[remedy], `${locale}/${remedy}`).toBeTruthy();
      }
    }
  });

  test('Platzhalter werden ersetzt', () => {
    expect(fillCopy('{days} Tage Stoff', { days: 12 })).toBe('12 Tage Stoff');
    expect(fillCopy('{unbekannt}', {})).toBe('{unbekannt}');
  });
});
