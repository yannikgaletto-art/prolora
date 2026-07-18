// GOAL-RUN8 T1.6/T1.7 — editor mutations stay deterministic and testable.
import { describe, expect, test } from 'vitest';
import { moveLinksToFirstComment, replaceFirstLine } from '@/app/(dashboard)/publish/impact-card-logic';

describe('replaceFirstLine', () => {
  test('replaces only the hook and preserves the post body', () => {
    expect(replaceFirstLine('Old hook\n\nBody stays.', 'New hook')).toBe('New hook\n\nBody stays.');
  });
});

describe('moveLinksToFirstComment', () => {
  test('removes body links and appends a contextual first comment', () => {
    const result = moveLinksToFirstComment({
      content: 'Read the guide: https://example.com/guide\n\nIt is practical.',
      bodyLinks: ['https://example.com/guide'],
      firstComment: 'Existing note.',
      contextSentence: 'Here is the referenced link:',
    });

    expect(result.content).toBe('Read the guide:\n\nIt is practical.');
    expect(result.firstComment).toBe(
      'Existing note.\n\nHere is the referenced link: https://example.com/guide'
    );
  });
});
