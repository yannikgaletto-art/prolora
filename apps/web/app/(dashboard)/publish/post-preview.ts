import type { PlatformType } from '@prolora/shared';

const URL_PATTERN = /https?:\/\/[^\s]+/g;

export function unicodeBold(value: string): string {
  return [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d400 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d41a + code - 97);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ce + code - 48);
    return character;
  }).join('');
}

export interface PostPreviewModel {
  content: string;
  firstComment: string | null;
  characterCount: number;
  characterLimit: number;
  overLimit: boolean;
  note: string | null;
}

export function buildPostPreview(input: {
  platform: PlatformType;
  masterContent: string;
  overrideContent?: string;
  firstComment?: string;
  characterLimit: number;
}): PostPreviewModel {
  const source = input.overrideContent ?? input.masterContent;
  const urls = source.match(URL_PATTERN) ?? [];
  const moveLinks = input.platform === 'linkedin' && urls.length > 0;
  const content = moveLinks
    ? source.replace(URL_PATTERN, '').replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim()
    : source;
  const firstCommentParts = [input.firstComment?.trim(), moveLinks ? urls.join('\n') : undefined]
    .filter((part): part is string => Boolean(part));

  return {
    content,
    firstComment: firstCommentParts.length > 0 ? firstCommentParts.join('\n\n') : null,
    characterCount: content.length,
    characterLimit: input.characterLimit,
    overLimit: content.length > input.characterLimit,
    note: moveLinks
      ? 'LinkedIn convention: links are shown in the first comment. Enable platform adaptation before publishing to apply platform-native placement.'
      : null,
  };
}
