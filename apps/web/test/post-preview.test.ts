import { describe, expect, it } from 'vitest';
import { buildPostPreview, unicodeBold } from '../app/(dashboard)/publish/post-preview';

describe('buildPostPreview', () => {
  it('uses an account override and shows LinkedIn links in the first-comment convention', () => {
    const preview = buildPostPreview({
      platform: 'linkedin',
      masterContent: 'Master https://example.com',
      overrideContent: 'An update for LinkedIn https://prolora.eu/demo',
      firstComment: 'Sources: [1]',
      characterLimit: 3000,
    });

    expect(preview.content).toBe('An update for LinkedIn');
    expect(preview.firstComment).toContain('https://prolora.eu/demo');
    expect(preview.characterCount).toBe('An update for LinkedIn'.length);
    expect(preview.note).toMatch(/first comment/i);
  });

  it('keeps links inline on X', () => {
    const preview = buildPostPreview({
      platform: 'x',
      masterContent: 'Launch: https://prolora.eu',
      characterLimit: 280,
    });

    expect(preview.content).toContain('https://prolora.eu');
    expect(preview.firstComment).toBeNull();
    expect(preview.overLimit).toBe(false);
  });

  it('applies Unicode mathematical bold only when explicitly requested', () => {
    expect(unicodeBold('Bold 123')).toBe('𝐁𝐨𝐥𝐝 𝟏𝟐𝟑');
  });
});
