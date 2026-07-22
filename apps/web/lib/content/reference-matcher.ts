// Deterministic pattern matcher (GOAL-RUN9 §7 T1.3). Pure function, no DB and
// no AI: picking angles costs 0 credits (D7). Scoring is intentionally simple
// and fully testable — goal affinity beats tag overlap beats curator score.
import type { ContentGoal } from '@prolora/shared';
import type { ContentReferenceRow } from '@/lib/db';

// Which reference types serve which content goal (primary drafting signal).
const GOAL_TYPE_AFFINITY: Record<ContentGoal, ContentReferenceRow['reference_type'][]> = {
  authority: ['data_analysis', 'framework', 'case_study'],
  community: ['contrarian_take', 'mistake_to_learning'],
  productEducation: ['data_analysis', 'framework', 'case_study'],
  buildInPublic: ['strategy_change', 'founder_story'],
  conversion: ['case_study', 'founder_story'],
  personalStory: ['mistake_to_learning', 'founder_story', 'strategy_change'],
};

export interface MatchedReference {
  reference: ContentReferenceRow;
  score: number;
}

function normalize(term: string): string {
  return term.trim().toLowerCase();
}

export function matchReferences(
  references: ContentReferenceRow[],
  goal: ContentGoal,
  keywords: string[],
  limit = 3
): MatchedReference[] {
  const wanted = new Set(GOAL_TYPE_AFFINITY[goal]);
  const terms = keywords.map(normalize).filter(Boolean);

  const scored = references.map((reference) => {
    let score = 0;
    if (wanted.has(reference.reference_type)) score += 40;
    const tags = reference.relevance_tags.map(normalize);
    if (tags.includes(normalize(goal))) score += 30;
    const haystack = `${tags.join(' ')} ${normalize(reference.hook)} ${normalize(reference.reusable_pattern)}`;
    let keywordHits = 0;
    for (const term of terms) {
      if (term.length >= 3 && haystack.includes(term)) keywordHits += 1;
    }
    score += Math.min(keywordHits * 10, 30);
    score += reference.relevance_score / 10;
    return { reference, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.reference.relevance_score - a.reference.relevance_score ||
        a.reference.id.localeCompare(b.reference.id)
    )
    .slice(0, limit);
}
