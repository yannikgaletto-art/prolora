import type {
  ContentDnaAnalysis,
  ContentDnaFeatureKey,
  ContentDnaProfile,
  DnaConfidenceLevel,
  DnaLockedRule,
  DnaPromptRule,
  DnaSampleInput,
} from './types';

export const CONTENT_DNA_FEATURE_KEYS: readonly ContentDnaFeatureKey[] = [
  'sentence_length',
  'paragraph_length',
  'first_person',
  'questions',
  'exclamations',
  'lists',
  'cta',
  'opening_shapes',
  'whitespace',
];

const FIRST_PERSON_WORDS = new Set([
  'i',
  'me',
  'my',
  'mine',
  'myself',
  'we',
  'us',
  'our',
  'ours',
  'ourselves',
]);

const CTA_PATTERN =
  /\b(join|subscribe|follow|share|comment|reply|download|book|try|start|sign up|learn more|tell me|let me know)\b/iu;
const LIST_PATTERN = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S/u;

const NEUTRAL_PROFILE: ContentDnaProfile = {
  medianSentenceLength: 0,
  medianParagraphLength: 0,
  firstPersonRate: 0,
  questionRate: 0,
  exclamationRate: 0,
  listUsage: 0,
  ctaPresence: 0,
  commonOpeningShapes: [],
  preferredWhitespaceDensity: 0,
};

export function profileConfidence(sampleCount: number): DnaConfidenceLevel {
  if (sampleCount >= 15) return 'precise';
  if (sampleCount >= 5) return 'usable';
  if (sampleCount >= 3) return 'provisional';
  return 'low';
}

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

function sentences(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?])(?:\s+|$)|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function paragraphs(value: string): string[] {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function openingShape(content: string): string {
  const opening = content.trim().split(/\n/u, 1)[0]?.trim() ?? '';
  if (/^(?:[-*•]|\d+[.)])\s/u.test(opening)) return 'list';
  if (/^[“"'«]/u.test(opening)) return 'quote';
  if (/^\d/u.test(opening)) return 'number';
  if (/^(?:i|we|my|our)\b/iu.test(opening)) return 'first_person';
  if (opening.includes('?')) return 'question';
  return 'statement';
}

function derivePromptRules(
  profile: ContentDnaProfile,
  confidence: DnaConfidenceLevel
): DnaPromptRule[] {
  if (confidence === 'low') return [];
  const prefix = confidence === 'provisional' ? 'Soft preference: ' : '';
  const rules: DnaPromptRule[] = [
    {
      key: 'sentence_length',
      instruction: `${prefix}Prefer sentences around ${profile.medianSentenceLength} words.`,
      locked: false,
    },
    {
      key: 'paragraph_length',
      instruction: `${prefix}Prefer paragraphs around ${profile.medianParagraphLength} words.`,
      locked: false,
    },
  ];

  if (profile.firstPersonRate >= 0.03) {
    rules.push({
      key: 'first_person',
      instruction: `${prefix}Use a direct first-person voice where it is natural.`,
      locked: false,
    });
  }
  if (profile.questionRate >= 0.1) {
    rules.push({
      key: 'questions',
      instruction: `${prefix}Questions are a recurring part of the rhythm.`,
      locked: false,
    });
  }
  if (profile.exclamationRate >= 0.1) {
    rules.push({
      key: 'exclamations',
      instruction: `${prefix}Occasional exclamation marks fit the learned rhythm.`,
      locked: false,
    });
  }
  if (profile.listUsage >= 0.5) {
    rules.push({
      key: 'lists',
      instruction: `${prefix}Use lists when they make the structure easier to scan.`,
      locked: false,
    });
  }
  if (profile.ctaPresence >= 0.5) {
    rules.push({
      key: 'cta',
      instruction: `${prefix}End with a concise, relevant call to action.`,
      locked: false,
    });
  }
  if (profile.commonOpeningShapes[0]) {
    rules.push({
      key: 'opening_shapes',
      instruction: `${prefix}Favor ${profile.commonOpeningShapes.join(' or ')} openings.`,
      locked: false,
    });
  }
  if (profile.preferredWhitespaceDensity >= 0.15) {
    rules.push({
      key: 'whitespace',
      instruction: `${prefix}Use generous whitespace between ideas.`,
      locked: false,
    });
  }
  return rules;
}

export function analyzeContentDna(
  samples: readonly DnaSampleInput[],
  lockedRules: readonly DnaLockedRule[] = []
): ContentDnaAnalysis {
  const goldenSamples = samples.filter(
    (sample) => sample.kind === 'golden' && sample.active !== false
  );
  const sampleCount = goldenSamples.length;
  const level = profileConfidence(sampleCount);
  const preservedLockedRules = lockedRules
    .filter((rule): rule is DnaLockedRule => rule.locked === true)
    .map((rule) => ({ ...rule }));

  const confidence = {
    overall: level,
    features: Object.fromEntries(
      CONTENT_DNA_FEATURE_KEYS.map((key) => [key, { level, sampleCount }])
    ) as ContentDnaAnalysis['confidence']['features'],
  };

  if (sampleCount <= 2) {
    return {
      profile: { ...NEUTRAL_PROFILE, commonOpeningShapes: [] },
      confidence,
      promptRules: preservedLockedRules,
      lockedRules: preservedLockedRules,
      sampleCount,
    };
  }

  const allSentences = goldenSamples.flatMap((sample) => sentences(sample.content));
  const allParagraphs = goldenSamples.flatMap((sample) => paragraphs(sample.content));
  const allWords = goldenSamples.flatMap((sample) => words(sample.content));
  const openingCounts = new Map<string, number>();
  for (const sample of goldenSamples) {
    const shape = openingShape(sample.content);
    openingCounts.set(shape, (openingCounts.get(shape) ?? 0) + 1);
  }
  const highestOpeningCount = Math.max(...openingCounts.values());
  const commonOpeningShapes = [...openingCounts.entries()]
    .filter(([, count]) => count === highestOpeningCount)
    .map(([shape]) => shape)
    .sort();

  const profile: ContentDnaProfile = {
    medianSentenceLength: median(allSentences.map((sentence) => words(sentence).length)),
    medianParagraphLength: median(allParagraphs.map((paragraph) => words(paragraph).length)),
    firstPersonRate: ratio(
      allWords.filter((word) => FIRST_PERSON_WORDS.has(word.toLocaleLowerCase('en'))).length,
      allWords.length
    ),
    questionRate: ratio(
      allSentences.filter((sentence) => sentence.includes('?')).length,
      allSentences.length
    ),
    exclamationRate: ratio(
      allSentences.filter((sentence) => sentence.includes('!')).length,
      allSentences.length
    ),
    listUsage: ratio(
      goldenSamples.filter((sample) => LIST_PATTERN.test(sample.content)).length,
      sampleCount
    ),
    ctaPresence: ratio(
      goldenSamples.filter((sample) => CTA_PATTERN.test(sample.content)).length,
      sampleCount
    ),
    commonOpeningShapes,
    preferredWhitespaceDensity: median(
      goldenSamples.map((sample) => {
        const lines = sample.content.replace(/\r\n?/g, '\n').split('\n');
        return ratio(lines.filter((line) => line.trim() === '').length, lines.length);
      })
    ),
  };

  const lockedKeys = new Set(preservedLockedRules.map((rule) => rule.key));
  const derivedRules = derivePromptRules(profile, level).filter(
    (rule) => !lockedKeys.has(rule.key)
  );

  return {
    profile,
    confidence,
    promptRules: [...derivedRules, ...preservedLockedRules],
    lockedRules: preservedLockedRules,
    sampleCount,
  };
}
