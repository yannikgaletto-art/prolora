// Plan 2 / 2A.4 — Signal-Inventar (Vertrag C3).
//
// Die reinen Teile der fünf Quellen plus die Zusage, dass ein fehlendes Schema
// ein LEERES Inventar liefert und keinen 500er.
import { describe, expect, test, vi } from 'vitest';

const missingTableError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.feedback_themes' in the schema cache",
};

function missingTableChain(): Record<string, unknown> {
  const result = Promise.resolve({ data: null, error: missingTableError });
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'eq', 'neq', 'or', 'in', 'is', 'not', 'gte', 'lte', 'order',
    'limit', 'insert', 'upsert', 'update', 'delete', 'single', 'maybeSingle', 'returns',
  ];
  for (const method of methods) {
    chain[method] = () => Object.assign(result, chain);
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({ from: () => missingTableChain() }),
  };
});

import {
  aggregateCommunityQuestions,
  countCoverageDays,
  getCoverageDays,
  isProofReferenced,
  listSignals,
  winnerStrength,
  type SignalKind,
} from '@/lib/pipeline/inventory';

describe('countCoverageDays', () => {
  const now = new Date('2026-07-25T09:00:00.000Z');

  test('zählt distinkte künftige Kalendertage, nicht Posts', () => {
    expect(
      countCoverageDays(
        [
          '2026-07-25T18:00:00.000Z',
          '2026-07-25T20:00:00.000Z', // selber Tag
          '2026-07-26T09:00:00.000Z',
          '2026-07-28T09:00:00.000Z',
        ],
        now
      )
    ).toBe(3);
  });

  test('Vergangenes und Unbrauchbares zählt nicht', () => {
    expect(countCoverageDays(['2026-07-01T09:00:00.000Z', null, 'kaputt'], now)).toBe(0);
  });
});

describe('isProofReferenced', () => {
  const proof = 'Die Support-Tickets sind seit dem Umstieg um 31 Prozent gesunken.';

  test('erkennt einen wörtlich verwendeten Beleg', () => {
    const corpus = `Kurzer Vorspann. ${proof} Danach noch etwas Text.`;
    expect(isProofReferenced(proof, corpus)).toBe(true);
  });

  test('meldet einen ungenutzten Beleg als ungenutzt', () => {
    expect(isProofReferenced(proof, 'Wir haben diese Woche ein neues Feature gebaut.')).toBe(false);
  });

  test('leerer Korpus heißt: nichts wurde je erzählt', () => {
    expect(isProofReferenced(proof, '')).toBe(false);
  });

  test('Interpunktion und Groß-/Kleinschreibung sind egal', () => {
    expect(isProofReferenced(proof, proof.toUpperCase().replace(/\./g, ''))).toBe(true);
  });
});

describe('aggregateCommunityQuestions', () => {
  test('dieselbe Frage aus mehreren Communities zählt stärker, nicht doppelt', () => {
    const result = aggregateCommunityQuestions([
      { id: 'c1', relevanceScore: 80, questions: ['Wie migriere ich meine Daten?'] },
      { id: 'c2', relevanceScore: 70, questions: ['wie migriere ich meine daten?'] },
      { id: 'c3', relevanceScore: 60, questions: ['Was kostet der Betrieb im Monat?'] },
    ]);
    expect(result).toHaveLength(2);
    const repeated = result.find((entry) => entry.communityIds.length === 2);
    expect(repeated).toBeDefined();
    expect(repeated!.communityIds).toEqual(['c1', 'c2']);
    expect(repeated!.strength).toBeGreaterThan(result[result.length - 1].strength);
  });

  test('zu kurze Fragen werden verworfen', () => {
    expect(aggregateCommunityQuestions([{ id: 'c1', relevanceScore: 90, questions: ['Wie?'] }])).toEqual([]);
  });

  test('Stärke bleibt in 0..1', () => {
    const result = aggregateCommunityQuestions([
      { id: 'c1', relevanceScore: 100, questions: ['Eine ausreichend lange Frage?'] },
      { id: 'c2', relevanceScore: 100, questions: ['Eine ausreichend lange Frage?'] },
      { id: 'c3', relevanceScore: 100, questions: ['Eine ausreichend lange Frage?'] },
      { id: 'c4', relevanceScore: 100, questions: ['Eine ausreichend lange Frage?'] },
    ]);
    expect(result[0].strength).toBeLessThanOrEqual(1);
    expect(result[0].strength).toBeGreaterThan(0.9);
  });
});

describe('winnerStrength', () => {
  test('größerer Baseline-Abstand = stärkeres Signal', () => {
    expect(winnerStrength(4, 30)).toBeGreaterThan(winnerStrength(1.2, 30));
  });

  test('kleine Baseline wird gedämpft, nicht verworfen', () => {
    expect(winnerStrength(4, 2)).toBeLessThan(winnerStrength(4, 40));
    expect(winnerStrength(4, 2)).toBeGreaterThan(0);
  });

  test('bleibt in 0..1, auch bei Unsinnswerten', () => {
    for (const [ratio, n] of [[null, null], [0, 0], [999, 999], [-5, 10]] as Array<[number | null, number | null]>) {
      const value = winnerStrength(ratio, n);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('Degradation ohne Migrationen', () => {
  test('listSignals liefert ein leeres Inventar statt zu werfen', async () => {
    await expect(listSignals('ws-1')).resolves.toEqual([]);
  });

  test('einzelne Signalarten degradieren genauso', async () => {
    const kinds: SignalKind[] = [
      'feedback_theme',
      'unused_proof',
      'community_question',
      'splinter',
      'winner_followup',
    ];
    for (const kind of kinds) {
      await expect(listSignals('ws-1', { kinds: [kind] }), kind).resolves.toEqual([]);
    }
  });

  test('getCoverageDays meldet 0 statt zu crashen', async () => {
    await expect(getCoverageDays('ws-1')).resolves.toBe(0);
  });
});
