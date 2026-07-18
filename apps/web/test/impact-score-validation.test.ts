// GOAL-RUN8 T1.4 — shared validation keeps REST and future clients aligned.
import { describe, expect, test } from 'vitest';
import { scorePostSchema } from '@prolora/shared';

describe('scorePostSchema', () => {
  test('accepts all scoring inputs within their limits', () => {
    const result = scorePostSchema.safeParse({
      content: 'A useful post.',
      platform: 'linkedin',
      first_comment: 'Context only.',
      language: 'de',
      connection_id: '11111111-1111-4111-8111-111111111111',
    });

    expect(result.success).toBe(true);
    expect(result.data?.connection_id).toBe('11111111-1111-4111-8111-111111111111');
  });

  test('rejects blank content, unsupported platforms and long comments', () => {
    expect(scorePostSchema.safeParse({ content: '', platform: 'linkedin' }).success).toBe(false);
    expect(scorePostSchema.safeParse({ content: 'Post', platform: 'instagram' }).success).toBe(false);
    expect(
      scorePostSchema.safeParse({
        content: 'Post',
        platform: 'x',
        first_comment: 'x'.repeat(2001),
      }).success
    ).toBe(false);
  });

  test('accepts 30,000 characters but rejects 30,001', () => {
    expect(scorePostSchema.safeParse({ content: 'x'.repeat(30_000), platform: 'x' }).success).toBe(true);
    expect(scorePostSchema.safeParse({ content: 'x'.repeat(30_001), platform: 'x' }).success).toBe(false);
  });
});
