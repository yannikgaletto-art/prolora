import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  new URL('../app/(dashboard)/publish/posts/PostsExplorer.tsx', import.meta.url),
  'utf8'
);

describe('publish reconciliation UI', () => {
  test('offers both explicit operator resolutions and collects the external post identity', () => {
    expect(source).toContain('Confirm no post exists and retry');
    expect(source).toContain('Confirm post exists');
    expect(source).toContain("resolution: 'published'");
    expect(source).toContain('platform_post_id');
    expect(source).toContain('platform_url');
  });
});
