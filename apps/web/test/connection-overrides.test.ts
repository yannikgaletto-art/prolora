import { describe, expect, it } from 'vitest';
import { resolveConnectionPayload } from '@/lib/posts/resolve-payload';

describe('resolveConnectionPayload', () => {
  it('keeps two accounts on the same platform independent', () => {
    const payload = resolveConnectionPayload({
      connectionId: '11111111-1111-4111-8111-111111111111',
      content: 'Master copy',
      media: [],
      connectionOverrides: {
        '11111111-1111-4111-8111-111111111111': { content: 'Founder voice' },
        '22222222-2222-4222-8222-222222222222': { content: 'Recruiting voice' },
      },
    });

    expect(payload.content).toBe('Founder voice');
    expect(payload.media).toEqual([]);
  });
});
