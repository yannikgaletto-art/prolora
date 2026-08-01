import { sha256Hex } from './hash';
import type { ContentSampleKind } from './types';

export interface CuratedGoldenSample {
  bundleKey: string;
  bundleVersion: string;
  sourceFile: string;
  title: string;
  language: 'de' | 'en';
  category: string;
  platform: string | null;
  hookType: string;
  contentFormat: string;
  content: string;
  maskedContent: string;
  contentHash: string;
  maskedContentHash: string;
}

export interface RetrievableSample {
  id: string;
  kind: ContentSampleKind;
  active: boolean;
  platform: string | null;
  category: string | null;
  hookType: string | null;
  contentFormat: string | null;
  maskedContent: string;
  contentHash: string;
  content?: string;
}

export type RetrievedGoldenSample = Omit<RetrievableSample, 'content' | 'kind' | 'active'>;

const field = (text: string, name: string): string | null => {
  const match = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`, 'imu').exec(text);
  return match?.[1]?.trim() ?? null;
};

const normalizePlatform = (value: string | null): string | null => {
  if (!value || /nicht angegeben/i.test(value)) return null;
  const normalized = value.trim().toLocaleLowerCase('de');
  return normalized === 'twitter' ? 'x' : normalized;
};

const inferHook = (title: string): string => {
  if (title.includes('?')) return 'question';
  if (/\d/u.test(title)) return 'number';
  if (/fehler|warnsignal|beerdigt|gehasst|rechnung/iu.test(title)) return 'confession';
  if (/warum|trotzdem|gelernt/iu.test(title)) return 'lesson';
  return 'statement';
};

const normalizeFormat = (value: string | null, platform: string | null): string => {
  if (/thread/iu.test(value ?? '')) return 'thread';
  if (/single/iu.test(value ?? '')) return 'single_post';
  return platform === 'x' ? 'single_post' : 'longform_post';
};

/** Golden Samples provide rhythm and structure, never factual prompt context. */
export function maskGoldenSample(content: string): string {
  return content
    .replace(/\[[^\]\n]{1,80}\]/gu, '[PLACEHOLDER]')
    .replace(/https?:\/\/[^\s<>)\]}]+/giu, '[LINK]')
    .replace(/\b(?:Pathly|Prolora|EchoHub)\b/giu, '[PRODUCT]')
    .replace(
      /(?:\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*(?:%|€|EUR|USD|\$|Nutzer(?:innen)?|User|Credits?|Monate?|Wochen?|Tage?|Jahre?|Uhr)?|[€$]\s*\d+(?:[.,]\d+)*)/giu,
      '[METRIC]'
    )
    .replace(/\s+(?:%|€|EUR|USD|\$)/giu, '')
    .replace(/(?:\[METRIC\]\s*){2,}/gu, '[METRIC] ')
    .trim();
}

export function parseGoldenSampleBundle(
  markdown: string,
  sourceFile: string,
  bundleVersion: string
): CuratedGoldenSample[] {
  const category = /^Kategorie:\s*(.+)$/imu.exec(markdown)?.[1]?.trim() ?? 'Uncategorized';
  const languageLabel = /^Sprache:\s*(.+)$/imu.exec(markdown)?.[1]?.trim() ?? 'Deutsch';
  const language = /^engl/iu.test(languageLabel) ? 'en' : 'de';
  const sections = [
    ...markdown.matchAll(/^##\s+(\d+)\.\s+([^\n]+)$(.*?)(?=^##\s+\d+\.|(?![\s\S]))/gmsu),
  ];

  return sections.map((match) => {
    const ordinal = match[1];
    const heading = match[2].trim();
    const body = match[3].trim();
    const title = field(body, 'Titel') ?? heading;
    const platform = normalizePlatform(field(body, 'Plattform'));
    const hookType = field(body, 'Hook-Typ') ?? inferHook(title);
    const contentFormat = normalizeFormat(field(body, 'Format'), platform);
    const content = body
      .replace(/^\*\*(?:Titel|Plattform|Hook-Typ|Format):\*\*.*$\n?/gimu, '')
      .trim();
    const maskedContent = maskGoldenSample(content);

    return {
      bundleKey: `${sourceFile.replace(/\.md$/u, '')}:${ordinal}`,
      bundleVersion,
      sourceFile,
      title,
      language,
      category,
      platform,
      hookType,
      contentFormat,
      content,
      maskedContent,
      contentHash: sha256Hex(content),
      maskedContentHash: sha256Hex(maskedContent),
    };
  });
}

export function retrieveGoldenSamples(
  samples: readonly RetrievableSample[],
  query: { platform: string; category?: string | null; recentSampleIds?: readonly string[] }
): RetrievedGoldenSample[] {
  const recent = new Set(query.recentSampleIds ?? []);
  const ranked = samples
    .filter((sample) => sample.kind === 'golden' && sample.active && sample.maskedContent.trim())
    .map((sample, index) => ({
      sample,
      index,
      score:
        (sample.platform === query.platform ? 100 : sample.platform === null ? 20 : 0) +
        (query.category && sample.category === query.category ? 40 : 0) -
        (recent.has(sample.id) ? 60 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: RetrievableSample[] = [];
  for (const candidate of ranked) {
    if (selected.length >= 2) break;
    if (
      selected.length === 1 &&
      candidate.sample.hookType &&
      selected[0].hookType === candidate.sample.hookType &&
      ranked.some(
        (alternative) =>
          !selected.includes(alternative.sample) &&
          alternative.sample.hookType !== candidate.sample.hookType &&
          alternative.score === candidate.score
      )
    ) {
      continue;
    }
    selected.push(candidate.sample);
  }

  return selected.map(({ content: _content, kind: _kind, active: _active, ...safe }) => safe);
}
