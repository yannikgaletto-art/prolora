// Frequenz-Motor (Plan 2 / 2B.4).
//
// "Der Scheduler wählt nach Mix, nicht nach Reihenfolge" ist ohne Test eine
// Behauptung. Bei 3 Posts/Tag entscheidet genau diese Auswahl darüber, ob ein
// Konto nach vier Wochen noch unterscheidbare Beiträge veröffentlicht.
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CONTENT_MIX,
  emptyMixCounts,
  mixBucketForSignal,
  normalizeMix,
  selectByMix,
  type MixCandidate,
} from '@/lib/pipeline/orchestrator';
import type { MixBucket } from '@/lib/pipeline/state';

function pool(bucket: MixBucket, count: number, strengthBase = 0.5): MixCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${bucket}-${index}`,
    mixBucket: bucket,
    strength: strengthBase + index / 1000,
  }));
}

function distribution(picked: MixCandidate[]): Record<MixBucket, number> {
  const counts = emptyMixCounts();
  for (const candidate of picked) counts[candidate.mixBucket] += 1;
  return counts;
}

describe('Content-Mix', () => {
  test('der Standard-Mix ist 40/30/20/10', () => {
    expect(DEFAULT_CONTENT_MIX).toEqual({ insight: 0.4, proof: 0.3, story: 0.2, question: 0.1 });
  });

  test('ein Teil-Mix wird auf Summe 1 normalisiert', () => {
    const mix = normalizeMix({ insight: 2, proof: 2, story: 0, question: 0 });
    expect(mix.insight).toBeCloseTo(0.5);
    expect(mix.proof).toBeCloseTo(0.5);
    expect(mix.story).toBe(0);
    const total = Object.values(mix).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1);
  });

  test('ein leerer Mix fällt auf den Standard zurück statt durch 0 zu teilen', () => {
    expect(normalizeMix({ insight: 0, proof: 0, story: 0, question: 0 })).toEqual(
      DEFAULT_CONTENT_MIX
    );
  });
});

describe('Auswahl nach Mix statt nach Reihenfolge', () => {
  test('aus 10 Insight-Kandidaten wird bei gemischtem Angebot nicht 10x Insight', () => {
    const candidates = [
      ...pool('insight', 10),
      ...pool('proof', 10),
      ...pool('story', 10),
      ...pool('question', 10),
    ];
    const picked = selectByMix({ candidates, take: 10 });
    const counts = distribution(picked);

    expect(picked).toHaveLength(10);
    expect(counts.insight).toBe(4);
    expect(counts.proof).toBe(3);
    expect(counts.story).toBe(2);
    expect(counts.question).toBe(1);
  });

  test('die bisherige Verteilung wird berücksichtigt — Nachholen statt Verdoppeln', () => {
    const candidates = [...pool('insight', 5), ...pool('proof', 5), ...pool('story', 5)];
    // Bereits 9 Insight-Posts, sonst nichts: der Mix muss gegensteuern.
    const picked = selectByMix({
      candidates,
      recentCounts: { insight: 9, proof: 0, story: 0, question: 0 },
      take: 3,
    });
    const counts = distribution(picked);
    expect(counts.insight).toBe(0);
    expect(counts.proof + counts.story).toBe(3);
  });

  test('innerhalb eines Buckets gewinnt die höhere Stärke', () => {
    const candidates: MixCandidate[] = [
      { id: 'weak', mixBucket: 'insight', strength: 0.1 },
      { id: 'strong', mixBucket: 'insight', strength: 0.9 },
    ];
    const picked = selectByMix({ candidates, take: 1 });
    expect(picked[0].id).toBe('strong');
  });

  test('fehlende Buckets blockieren die Auswahl nicht', () => {
    const picked = selectByMix({ candidates: pool('story', 3), take: 3 });
    expect(picked).toHaveLength(3);
    expect(distribution(picked).story).toBe(3);
  });

  test('mehr angefordert als vorhanden liefert alles Vorhandene, nicht mehr', () => {
    const picked = selectByMix({ candidates: pool('proof', 2), take: 5 });
    expect(picked).toHaveLength(2);
  });

  test('take = 0 wählt nichts', () => {
    expect(selectByMix({ candidates: pool('insight', 5), take: 0 })).toEqual([]);
  });
});

describe('Signalart bestimmt den Mix-Bucket', () => {
  test('jede Signalart landet in genau einem Bucket', () => {
    expect(mixBucketForSignal('unused_proof')).toBe('proof');
    expect(mixBucketForSignal('community_question')).toBe('question');
    expect(mixBucketForSignal('splinter')).toBe('story');
    expect(mixBucketForSignal('feedback_theme')).toBe('insight');
    expect(mixBucketForSignal('winner_followup')).toBe('insight');
  });
});
