// Plan 2 / 2A.3 — Proof-Extraktion.
//
// Zwei Dinge werden hier festgenagelt, weil sie die eigentliche Zusage sind:
//   1. Ein Vorschlag ist IMMER ein wörtlicher Satz aus der Quelle (keine
//      Umformulierung, keine Erfindung).
//   2. Ein Kundenzitat ist ohne Zustimmung im Quality-Gate NICHT verwendbar.
import { describe, expect, test } from 'vitest';
import {
  extractProofCandidates,
  isProofUsableInGate,
  splitSentences,
  PROOF_GATE_USABLE_STATUSES,
} from '@/lib/feedback/proof-extraction';

const anonymous = { sourceAuthor: null, sourcePlatform: 'widget', sourceUrl: null };
const named = { sourceAuthor: 'Lena K.', sourcePlatform: 'trustpilot', sourceUrl: 'https://example.test/r/1' };

describe('splitSentences', () => {
  test('trennt an Satzzeichen und Zeilenumbrüchen', () => {
    expect(splitSentences('Erster Satz. Zweiter Satz!\nDritter Satz?')).toEqual([
      'Erster Satz.',
      'Zweiter Satz!',
      'Dritter Satz?',
    ]);
  });
});

describe('extractProofCandidates', () => {
  test('erkennt ein messbares Ergebnis als metric', () => {
    const candidates = extractProofCandidates(
      'Seit dem Umstieg sind unsere Support-Tickets um 31 % gesunken. Sonst nichts Neues.',
      anonymous
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('metric');
    expect(candidates[0].requiresConsent).toBe(false);
  });

  test('zitiert WÖRTLICH — kein umformulierter Beleg', () => {
    const source = 'Wir haben damit 2 Stunden pro Woche gespart.';
    const candidates = extractProofCandidates(`Kurzer Vorspann ohne Zahl. ${source}`, anonymous);
    expect(candidates[0].content).toBe(source);
  });

  test('eine Zahl ohne Ergebnis-Aussage ist kein Beleg', () => {
    expect(
      extractProofCandidates('Wir nutzen die Version 3 seit dem 12. Januar dieses Jahres.', anonymous)
    ).toHaveLength(0);
  });

  test('vage Begeisterung erzeugt keinen Beleg', () => {
    expect(
      extractProofCandidates('Das Tool ist wirklich großartig und hat alles verbessert.', named)
    ).toHaveLength(0);
  });

  test('identifizierbare Person -> Zustimmung zwingend', () => {
    const candidates = extractProofCandidates(
      'Unser Team hat die Bearbeitungszeit um 40 % reduziert.',
      named
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].requiresConsent).toBe(true);
  });

  test('anonymes Feedback derselben Aussage braucht keine Zustimmung', () => {
    const candidates = extractProofCandidates(
      'Unser Team hat die Bearbeitungszeit um 40 % reduziert.',
      anonymous
    );
    expect(candidates[0].requiresConsent).toBe(false);
  });

  test('liefert höchstens drei Kandidaten, stärkster zuerst', () => {
    const text = [
      'Wir haben 10 % gespart.',
      'Die Ladezeit ist um 50 % gesunken.',
      'Die Fehlerquote ist um 5 % gesunken.',
      'Der Umsatz ist um 12 % gestiegen.',
      'Die Reaktionszeit ist um 3 Stunden gesunken.',
    ].join(' ');
    const candidates = extractProofCandidates(text, anonymous);
    expect(candidates.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1].confidence).toBeGreaterThanOrEqual(candidates[i].confidence);
    }
  });

  test('Dubletten im selben Text werden zusammengefasst', () => {
    const sentence = 'Die Ticketzahl ist um 31 % gesunken.';
    const candidates = extractProofCandidates(`${sentence} ${sentence}`, anonymous);
    expect(candidates).toHaveLength(1);
  });
});

describe('Gate-Verwendbarkeit (DSGVO)', () => {
  test('nur not_required und granted sind nutzbar', () => {
    expect([...PROOF_GATE_USABLE_STATUSES]).toEqual(['not_required', 'granted']);
    expect(isProofUsableInGate({ consent_status: 'granted' })).toBe(true);
    expect(isProofUsableInGate({ consent_status: 'not_required' })).toBe(true);
    expect(isProofUsableInGate({ consent_status: 'pending' })).toBe(false);
    expect(isProofUsableInGate({ consent_status: 'denied' })).toBe(false);
  });

  test('Zeilen aus der Zeit vor Migration 016 bleiben nutzbar', () => {
    expect(isProofUsableInGate({})).toBe(true);
    expect(isProofUsableInGate({ consent_status: null })).toBe(true);
  });
});
