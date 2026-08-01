import type { ProductMentionDecision } from '@/lib/generation/types';
import type { ConfirmedFact } from '@/lib/product/facts';
import type { GateFinding } from './quality-gate';

export interface NarrativeSampleContext {
  id: string;
  maskedContent: string;
}

export interface NarrativeGateContext {
  language: 'de' | 'en';
  mention: ProductMentionDecision;
  facts: ConfirmedFact[];
  samples: NarrativeSampleContext[];
  semanticJudgeRequired: boolean;
  semanticJudge?: (input: {
    content: string;
    language: 'de' | 'en';
    facts: ConfirmedFact[];
    mention: ProductMentionDecision;
  }) => Promise<GateFinding[]>;
}

const result = (
  check: GateFinding['check'],
  status: GateFinding['status'],
  message: string,
  remedy: GateFinding['remedy'] = null,
  span: GateFinding['span'] = null
): GateFinding => ({ check, status, passed: status === 'passed', message, remedy, span });

const GERMAN = new Set(['ich', 'habe', 'beim', 'etwas', 'gelernt', 'und', 'der', 'die', 'das', 'wir', 'nicht']);
const ENGLISH = new Set(['i', 'have', 'while', 'something', 'learned', 'and', 'the', 'we', 'not', 'building']);

function languageScore(content: string, words: Set<string>): number {
  return (content.toLocaleLowerCase().match(/[\p{L}]+/gu) ?? [])
    .filter((word) => words.has(word)).length;
}

function checkLanguage(content: string, language: 'de' | 'en'): GateFinding {
  const german = languageScore(content, GERMAN);
  const english = languageScore(content, ENGLISH);
  const mismatch = language === 'de' ? english > german + 1 : german > english + 1;
  return mismatch
    ? result('language', 'failed', `Draft language does not match ${language}.`, 'correct_language')
    : result('language', 'passed', `Draft language matches ${language}.`);
}

function checkMention(content: string, decision: ProductMentionDecision): GateFinding {
  const hasMention = /\b(?:pathly|prolora)\b/iu.test(content);
  if (decision.decision === 'omit' && hasMention) {
    return result('mention', 'failed', 'The draft contains a product mention that was explicitly omitted.', 'remove_mention');
  }
  if (decision.decision === 'include' && !hasMention) {
    return result('mention', 'failed', 'The approved product mention is missing.', 'place_mention');
  }
  return result('mention', 'passed', 'Product mention matches the structured decision.');
}

const normalizedWords = (content: string): string[] =>
  content.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function ngrams(content: string, size = 8): Set<string> {
  const words = normalizedWords(content);
  const output = new Set<string>();
  for (let index = 0; index + size <= words.length; index++) {
    output.add(words.slice(index, index + size).join(' '));
  }
  return output;
}

function checkSampleCopy(content: string, samples: readonly NarrativeSampleContext[]): GateFinding {
  const draft = ngrams(content);
  for (const sample of samples) {
    const overlap = [...ngrams(sample.maskedContent)].find((entry) => draft.has(entry));
    if (overlap) {
      return result('sample_copy', 'failed', `Draft copies a Golden Sample phrase: “${overlap}”.`, 'differentiate');
    }
  }
  return result('sample_copy', 'passed', 'No verbatim Golden Sample phrase was found.');
}

function checkPlaceholders(content: string): GateFinding {
  const match = /\[(?:X|PLACEHOLDER|METRIC|PRODUCT|LINK)[^\]]*\]/iu.exec(content);
  return match?.index !== undefined
    ? result(
        'narrative_consistency', 'failed', 'The draft contains an unresolved placeholder.',
        'needs_input', { start: match.index, end: match.index + match[0].length }
      )
    : result('narrative_consistency', 'passed', 'No unresolved placeholders remain.');
}

export async function runNarrativeChecks(
  content: string,
  context: NarrativeGateContext
): Promise<{ findings: GateFinding[]; requiredCheckSkipped: boolean }> {
  const findings = [
    checkLanguage(content, context.language),
    checkMention(content, context.mention),
    checkSampleCopy(content, context.samples),
    checkPlaceholders(content),
  ];
  if (findings.some((finding) => finding.status === 'failed')) {
    return { findings, requiredCheckSkipped: false };
  }
  if (context.semanticJudge) {
    findings.push(...await context.semanticJudge({
      content, language: context.language, facts: context.facts, mention: context.mention,
    }));
    return { findings, requiredCheckSkipped: false };
  }
  findings.push(result(
    'narrative_consistency',
    'skipped',
    'Semantic narrative judge did not run; this check did not pass.'
  ));
  return { findings, requiredCheckSkipped: context.semanticJudgeRequired };
}
