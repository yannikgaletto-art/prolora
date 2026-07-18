import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordAdapter } from '../lib/adapters/discord-adapter';
import { DevtoAdapter } from '../lib/adapters/devto-adapter';
import { HashnodeAdapter } from '../lib/adapters/hashnode-adapter';

afterEach(() => vi.unstubAllGlobals());

describe('new platform adapters', () => {
  it('publishes Discord content through the stored webhook and waits for a message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'message-1', channel_id: 'channel-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new DiscordAdapter().publish(
      { content: 'Hello Discord', connectionConfig: {} },
      { accessToken: 'https://discord.com/api/webhooks/123/token' }
    );
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('wait=true'), expect.objectContaining({ method: 'POST' }));
    expect(result.platformPostId).toBe('message-1');
  });

  it('rejects Discord video and document attachments instead of silently dropping them', () => {
    const adapter = new DiscordAdapter();
    expect(adapter.validateContent('Video', [{ storageKey: 'clip.mp4', mimeType: 'video/mp4' }]).valid).toBe(false);
    expect(adapter.validateContent('PDF', [{ storageKey: 'guide.pdf', mimeType: 'application/pdf' }]).valid).toBe(false);
  });

  it('uses the Forem api-key header when publishing to Dev.to', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 42, url: 'https://dev.to/demo' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await new DevtoAdapter().publish(
      { content: 'A useful title\n\nArticle body', connectionConfig: {} },
      { accessToken: 'dev-key' }
    );
    expect(fetchMock).toHaveBeenCalledWith('https://dev.to/api/articles', expect.objectContaining({ headers: expect.objectContaining({ 'api-key': 'dev-key' }) }));
  });

  it('sends a raw Hashnode PAT and the configured publication id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { publishPost: { post: { id: 'post-1', url: 'https://blog.example/post' } } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new HashnodeAdapter().publish(
      { content: 'Title\n\nBody', connectionConfig: { publication_id: 'pub-1' } },
      { accessToken: 'hashnode-pat' }
    );
    expect(fetchMock).toHaveBeenCalledWith('https://gql.hashnode.com', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'hashnode-pat' }) }));
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain('pub-1');
  });
});
