// GOAL-RUN8 T1.1: deterministic checks keep the live Impact Coach instant,
// explainable and free of AI-credit usage.
import type { PlatformType } from '@prolora/shared';
import { getPlatformRules } from '@/lib/validation/platform-rules';

export const DETERMINISTIC_VERSION = 1;

export const DETERMINISTIC_POINTS = {
  paragraph_length: 8,
  whitespace_ratio: 6,
  sentence_length: 6,
  body_link: 12,
  body_link_in_first_comment_penalty: 2,
  character_limit: 8,
  hashtag_penalty: 4,
} as const;

export const FOLD_LIMITS: Partial<Record<PlatformType, number>> = {
  linkedin: 210,
  telegram: 400,
};

export interface DeterministicCheck {
  id: string;
  passed: boolean;
  points: number;
  message_key: string;
}

export interface DeterministicResult {
  formatting_score: number;
  platform_hygiene_score: number;
  checks: DeterministicCheck[];
  body_links: string[];
  fold_text: string;
}

export function runDeterministicChecks(
  content: string,
  platform: PlatformType,
  opts: { firstComment?: string } = {}
): DeterministicResult {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return emptyResult();

  const paragraphs = normalized.split(/\n\s*\n/).map((paragraph) => paragraph.trim());
  const paragraphLengthPassed = paragraphs.every(
    (paragraph) => paragraph.length <= 280 && countSentences(paragraph) <= 3
  );

  const lines = normalized.split('\n');
  const blankLines = lines.filter((line) => line.trim().length === 0).length;
  const whitespaceRatioPassed = normalized.length <= 400 || blankLines / lines.length >= 0.25;

  const words = normalized.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
  const averageSentenceLength = words.length / Math.max(1, countSentences(normalized));
  const sentenceLengthPassed = averageSentenceLength <= 14;

  const formattingChecks: DeterministicCheck[] = [
    check(
      'paragraph_length',
      paragraphLengthPassed,
      DETERMINISTIC_POINTS.paragraph_length,
      'impact.check.paragraph_length'
    ),
    check(
      'whitespace_ratio',
      whitespaceRatioPassed,
      DETERMINISTIC_POINTS.whitespace_ratio,
      'impact.check.whitespace_ratio'
    ),
    check(
      'sentence_length',
      sentenceLengthPassed,
      DETERMINISTIC_POINTS.sentence_length,
      'impact.check.sentence_length'
    ),
  ];

  const bodyLinks = extractUrls(normalized);
  const firstComment = opts.firstComment?.trim() ?? '';
  const bodyLinksCopiedToComment =
    bodyLinks.length > 0 && bodyLinks.every((link) => firstComment.includes(link));
  const linkPassed = bodyLinks.length === 0;
  const linkPoints = linkPassed
    ? DETERMINISTIC_POINTS.body_link
    : bodyLinksCopiedToComment
      ? DETERMINISTIC_POINTS.body_link - DETERMINISTIC_POINTS.body_link_in_first_comment_penalty
      : 0;

  const rules = getPlatformRules(platform);
  const characterLimitPassed = measureLength(normalized, platform) <= rules.max_text_length;
  const hashtagPassed = countHashtags(normalized) <= 5;
  const hygieneChecks: DeterministicCheck[] = [
    {
      id: 'body_link',
      passed: linkPassed,
      points: linkPoints,
      message_key: bodyLinksCopiedToComment
        ? 'impact.check.body_link_duplicated'
        : 'impact.check.body_link',
    },
    check(
      'character_limit',
      characterLimitPassed,
      DETERMINISTIC_POINTS.character_limit,
      'impact.check.character_limit'
    ),
    {
      id: 'hashtag_count',
      passed: hashtagPassed,
      points: hashtagPassed ? 0 : -DETERMINISTIC_POINTS.hashtag_penalty,
      message_key: 'impact.check.hashtag_count',
    },
  ];

  return {
    formatting_score: formattingChecks.reduce((total, item) => total + item.points, 0),
    platform_hygiene_score: clampScore(
      hygieneChecks.reduce((total, item) => total + item.points, 0),
      20
    ),
    checks: [...formattingChecks, ...hygieneChecks],
    body_links: bodyLinks,
    fold_text: buildFoldText(normalized, platform),
  };
}

function emptyResult(): DeterministicResult {
  return {
    formatting_score: 0,
    platform_hygiene_score: 0,
    checks: [
      failedCheck('paragraph_length', 'impact.check.paragraph_length'),
      failedCheck('whitespace_ratio', 'impact.check.whitespace_ratio'),
      failedCheck('sentence_length', 'impact.check.sentence_length'),
      failedCheck('body_link', 'impact.check.body_link'),
      failedCheck('character_limit', 'impact.check.character_limit'),
      failedCheck('hashtag_count', 'impact.check.hashtag_count'),
    ],
    body_links: [],
    fold_text: '',
  };
}

function check(id: string, passed: boolean, points: number, messageKey: string): DeterministicCheck {
  return { id, passed, points: passed ? points : 0, message_key: messageKey };
}

function failedCheck(id: string, messageKey: string): DeterministicCheck {
  return { id, passed: false, points: 0, message_key: messageKey };
}

function countSentences(text: string): number {
  const chunks = text
    .split(/[.!?]+(?:["'”’)]*)\s+|[.!?]+(?:["'”’)]*)$/u)
    .filter((chunk) => chunk.trim().length > 0);
  return Math.max(1, chunks.length);
}

function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/giu) ?? [];
  return matches.map((match) => match.replace(/[),.;!?\]}]+$/u, ''));
}

function measureLength(text: string, platform: PlatformType): number {
  if (platform !== 'bluesky') return text.length;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let length = 0;
  for (const _ of segmenter.segment(text)) length++;
  return length;
}

function buildFoldText(content: string, platform: PlatformType): string {
  const limit = FOLD_LIMITS[platform];
  if (!limit || content.length <= limit) return content;
  const candidate = content.slice(0, limit + 1);
  const lastWhitespace = candidate.search(/\s+\S*$/u);
  if (lastWhitespace <= 0) return content.slice(0, limit);
  return candidate.slice(0, lastWhitespace).trimEnd();
}

function clampScore(score: number, max: number): number {
  return Math.min(max, Math.max(0, score));
}
