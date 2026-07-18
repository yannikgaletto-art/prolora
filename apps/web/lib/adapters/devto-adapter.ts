import { BaseAdapter } from './base-adapter';
import type { CommentParams, MediaAttachment, PostMetricsResult, PublishParams, PublishResult, RefreshResult, TokenInfo, ValidationResult } from './types';

export class DevtoAdapter extends BaseAdapter {
  readonly platform = 'devto' as const;

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const key = this.key(token);
    const [first = 'Untitled', ...rest] = params.content.split('\n');
    const title = first.replace(/^#+\s*/, '').trim().slice(0, 128) || 'Untitled';
    const body = rest.join('\n').trim() || params.content;
    const response = await fetch('https://dev.to/api/articles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.forem.api-v1+json', 'api-key': key },
      body: JSON.stringify({ article: { title, body_markdown: body, published: true } }),
    });
    if (!response.ok) throw this.classifyHttpError(response.status, await response.text());
    const article = (await response.json()) as { id: number; url: string };
    return { platformPostId: String(article.id), platformUrl: article.url, publishedAt: new Date() };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    return this.validateTextLength(content, 10000, media?.length, 0);
  }
  async postComment(_params: CommentParams, _token: TokenInfo): Promise<void> { throw this.createError('CONTENT_REJECTED', 'Dev.to comments are not supported'); }
  async getPostMetrics(_id: string, _token: TokenInfo): Promise<PostMetricsResult> { return { likes: 0, shares: 0, comments: 0, fetchedAt: new Date() }; }
  async refreshToken(_token: string): Promise<RefreshResult> { throw this.createError('AUTH_EXPIRED', 'Dev.to API keys do not refresh'); }
  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    const response = await fetch('https://dev.to/api/users/me', { headers: { Accept: 'application/vnd.forem.api-v1+json', 'api-key': this.key(token) } });
    return response.ok;
  }
  async deletePost(_id: string, _token: TokenInfo): Promise<void> { throw this.createError('CONTENT_REJECTED', 'Delete is not supported for Dev.to connections'); }
  private key(token: TokenInfo): string { if (!token.accessToken) throw this.createError('AUTH_REVOKED', 'Missing Dev.to API key'); return token.accessToken; }
}
