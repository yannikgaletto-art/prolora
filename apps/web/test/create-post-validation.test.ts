import { describe, expect, it } from 'vitest';
import { createPostSchema } from '@prolora/shared';

describe('createPostSchema media', () => {
  it('preserves the MIME type for a generated storage-key attachment', () => {
    const parsed = createPostSchema.parse({
      content: 'Post with an image',
      platforms: ['00000000-0000-4000-8000-000000000000'],
      media: [{ type: 'image', url: 'workspaces/ws/media/id/original.png', mime_type: 'image/png' }],
    });
    expect(parsed.media?.[0]?.mime_type).toBe('image/png');
  });
});
