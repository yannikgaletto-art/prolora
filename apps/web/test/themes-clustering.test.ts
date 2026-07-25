// Plan 2 / 2A.1 + 2A.2 — Theme-Clustering und Momentum.
//
// Der wichtigste Test hier ist "Stabilität über zwei Läufe" (Plan 2 §8): springt
// die Cluster-Identität, wird Momentum zu Rauschen und die ganze Signalquelle
// ist wertlos.
import { describe, expect, test } from 'vitest';
import {
  bucketByWindow,
  cosineSimilarity,
  deriveThemeLabel,
  meanVector,
  momentumFromCounts,
  parseVector,
  planClustering,
  serializeVector,
  updateCentroid,
  THEME_MATCH_THRESHOLD,
  type ClusterableItem,
  type ExistingTheme,
} from '@/lib/feedback/themes';

// 8-dimensionale Spielzeug-Vektoren: dieselbe Mathematik, lesbare Zahlen.
function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

const ONBOARDING = unit([1, 0.9, 0.1, 0, 0, 0, 0, 0]);
const ONBOARDING_NEAR = unit([0.95, 1, 0.15, 0.05, 0, 0, 0, 0]);
const ONBOARDING_NEAR_2 = unit([1, 0.85, 0.2, 0, 0.05, 0, 0, 0]);
const BILLING = unit([0, 0, 0, 0.1, 1, 0.9, 0, 0]);
const BILLING_NEAR = unit([0, 0.05, 0, 0.15, 0.95, 1, 0, 0]);

function item(id: string, embedding: number[], day: number, topics: string[] = []): ClusterableItem {
  return {
    id,
    embedding,
    occurredAt: new Date(Date.UTC(2026, 5, day)).toISOString(),
    topics,
    category: null,
    summary: null,
  };
}

describe('Vektor-Helfer', () => {
  test('parseVector liest das pgvector-Textformat', () => {
    expect(parseVector('[0.5,-0.25,1]')).toEqual([0.5, -0.25, 1]);
    expect(parseVector([0.5, 1])).toEqual([0.5, 1]);
    expect(parseVector('[]')).toBeNull();
    expect(parseVector('nicht-ein-vektor')).toBeNull();
    expect(parseVector(null)).toBeNull();
    expect(parseVector('[1,abc]')).toBeNull();
  });

  test('serializeVector ist die Umkehrung', () => {
    expect(parseVector(serializeVector([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  test('cosineSimilarity: identisch = 1, orthogonal = 0', () => {
    expect(cosineSimilarity(ONBOARDING, ONBOARDING)).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0); // Dimensionsbruch
  });

  test('updateCentroid ist der laufende Mittelwert', () => {
    expect(updateCentroid([0, 0], 1, [2, 4])).toEqual([1, 2]);
    expect(updateCentroid([1, 1], 3, [5, 5])).toEqual([2, 2]);
    expect(meanVector([[0, 0], [2, 4]])).toEqual([1, 2]);
  });
});

describe('planClustering', () => {
  test('gruppiert nahe Vektoren und trennt entfernte', () => {
    const plan = planClustering(
      [
        item('a', ONBOARDING, 1),
        item('b', ONBOARDING_NEAR, 2),
        item('c', BILLING, 3),
        item('d', BILLING_NEAR, 4),
      ],
      []
    );
    expect(plan.newThemes).toHaveLength(2);
    const keys = new Set(plan.assignments.map((assignment) => assignment.themeKey));
    expect(keys.size).toBe(2);
  });

  test('ein einzelnes Feedback wird kein Thema', () => {
    const plan = planClustering([item('lonely', ONBOARDING, 1)], []);
    expect(plan.newThemes).toHaveLength(0);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.skipped).toEqual(['lonely']);
  });

  test('bestehende Themen gewinnen vor Neugründung', () => {
    const existing: ExistingTheme[] = [{ id: 'theme-1', centroid: ONBOARDING, memberCount: 5 }];
    const plan = planClustering([item('a', ONBOARDING_NEAR, 1)], existing);
    expect(plan.newThemes).toHaveLength(0);
    expect(plan.assignments).toEqual([
      expect.objectContaining({ itemId: 'a', themeKey: 'theme-1' }),
    ]);
    expect(plan.assignments[0].similarity).toBeGreaterThanOrEqual(THEME_MATCH_THRESHOLD);
  });

  test('STABILITÄT: derselbe Stoff landet im zweiten Lauf im selben Thema', () => {
    const items = [
      item('a', ONBOARDING, 1),
      item('b', ONBOARDING_NEAR, 2),
      item('c', ONBOARDING_NEAR_2, 3),
      item('d', BILLING, 4),
      item('e', BILLING_NEAR, 5),
    ];

    // Lauf 1: aus dem Nichts.
    const first = planClustering(items, []);
    expect(first.newThemes.length).toBeGreaterThan(0);

    // Was Lauf 1 persistiert hätte.
    const persisted: ExistingTheme[] = first.newThemes.map((theme, index) => ({
      id: `theme-${index}`,
      centroid: theme.centroid,
      memberCount: theme.memberIds.length,
    }));
    const keyToId = new Map(first.newThemes.map((theme, index) => [theme.key, `theme-${index}`]));

    // Lauf 2: dieselben Items erneut (z. B. weil die Mitgliedertabelle leer war).
    const second = planClustering(items, persisted);

    expect(second.newThemes).toHaveLength(0); // KEIN Thema springt neu auf
    for (const assignment of first.assignments) {
      const again = second.assignments.find((entry) => entry.itemId === assignment.itemId);
      expect(again, assignment.itemId).toBeDefined();
      expect(again?.themeKey).toBe(keyToId.get(assignment.themeKey));
    }
  });

  test('deterministisch: Eingabereihenfolge ändert das Ergebnis nicht', () => {
    const items = [
      item('a', ONBOARDING, 1),
      item('b', ONBOARDING_NEAR, 2),
      item('c', BILLING, 3),
      item('d', BILLING_NEAR, 4),
    ];
    const forward = planClustering(items, []);
    const backward = planClustering([...items].reverse(), []);
    expect(backward.assignments).toEqual(forward.assignments);
    expect(backward.newThemes.map((theme) => theme.memberIds)).toEqual(
      forward.newThemes.map((theme) => theme.memberIds)
    );
  });
});

describe('deriveThemeLabel', () => {
  test('nimmt die häufigsten Topics', () => {
    const result = deriveThemeLabel([
      item('a', ONBOARDING, 1, ['onboarding', 'setup']),
      item('b', ONBOARDING, 2, ['onboarding']),
    ]);
    expect(result.label).toBe('Onboarding / Setup');
    expect(result.keywords).toEqual(['onboarding', 'setup']);
  });

  test('fällt auf die Kategorie zurück', () => {
    const result = deriveThemeLabel([
      { ...item('a', ONBOARDING, 1), category: 'bug' },
    ]);
    expect(result.label).toBe('Fehlerberichte');
  });

  test('fällt zuletzt auf die Zusammenfassung zurück', () => {
    const result = deriveThemeLabel([
      { ...item('a', ONBOARDING, 1), summary: 'Der Import bricht bei großen Dateien ab' },
    ]);
    expect(result.label).toBe('Der Import bricht bei großen Dateien ab');
  });
});

describe('Momentum', () => {
  test('bucketByWindow zählt in Wochenfenstern, jüngstes zuletzt', () => {
    const now = new Date('2026-07-25T12:00:00.000Z');
    const counts = bucketByWindow(
      [
        '2026-07-24T00:00:00.000Z', // aktuelles Fenster
        '2026-07-22T00:00:00.000Z', // aktuelles Fenster
        '2026-07-14T00:00:00.000Z', // ein Fenster davor
      ],
      now,
      7,
      3
    );
    expect(counts).toEqual([0, 1, 2]);
  });

  test('2 -> 14 ist ein starkes Signal, 12 -> 13 nicht', () => {
    const spike = momentumFromCounts([2, 2, 3, 2, 14]);
    const flat = momentumFromCounts([12, 12, 13, 12, 13]);
    expect(spike.strength).toBeGreaterThan(flat.strength);
    expect(spike.strength).toBeGreaterThan(0.5);
    expect(spike.recentCount).toBe(14);
    expect(spike.previousCount).toBe(2);
  });

  test('ein ruhiges Thema bekommt kaum Momentum', () => {
    const flat = momentumFromCounts([5, 5, 5, 5, 5]);
    expect(flat.strength).toBeLessThan(0.3);
    expect(flat.ratio).toBeCloseTo(1, 3);
  });

  test('ein Fenster ohne Nennung hat Momentum 0', () => {
    expect(momentumFromCounts([9, 8, 7, 0]).strength).toBe(0);
  });

  test('brandneues Thema ohne Historie wird nicht überbewertet', () => {
    const fresh = momentumFromCounts([0, 0, 0, 4]);
    expect(fresh.strength).toBeGreaterThan(0);
    expect(fresh.strength).toBeLessThanOrEqual(0.6);
  });

  test('Momentum liegt immer in 0..1', () => {
    for (const counts of [[1, 999], [0, 0, 0, 1], [3, 3, 3, 40], [50, 1]]) {
      const result = momentumFromCounts(counts);
      expect(result.strength).toBeGreaterThanOrEqual(0);
      expect(result.strength).toBeLessThanOrEqual(1);
    }
  });
});
