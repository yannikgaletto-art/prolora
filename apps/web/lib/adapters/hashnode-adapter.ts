import { BaseAdapter } from './base-adapter';
import type { CommentParams, MediaAttachment, PostMetricsResult, PublishParams, PublishResult, RefreshResult, TokenInfo, ValidationResult } from './types';

const ENDPOINT = 'https://gql.hashnode.com';

export class HashnodeAdapter extends BaseAdapter {
  readonly platform = 'hashnode' as const;

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const publicationId = typeof params.connectionConfig.publication_id === 'string' ? params.connectionConfig.publication_id : null;
    if (!publicationId) throw this.createError('CONTENT_REJECTED', 'Hashnode connection is missing publication_id');
    const [first = 'Untitled', ...rest] = params.content.split('\n');
    const variables = { input: { title: first.replace(/^#+\s*/, '').trim().slice(0, 150) || 'Untitled', contentMarkdown: rest.join('\n').trim() || params.content, publicationId } };
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: this.key(token) },
      body: JSON.stringify({ query: 'mutation PublishPost($input: PublishPostInput!) { publishPost(input: $input) { post { id url } } }', variables }),
    });
    const result = (await response.json().catch(() => null)) as { data?: { publishPost?: { post?: { id: string; url: string } } }; errors?: Array<{ message: string }> } | null;
    const post = result?.data?.publishPost?.post;
    if (!response.ok || !post) throw this.classifyHttpError(response.status || 400, result?.errors?.map((error) => error.message).join('; '));
    return { platformPostId: post.id, platformUrl: post.url, publishedAt: new Date() };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult { return this.validateTextLength(content, 10000, media?.length, 0); }
  async postComment(_params: CommentParams, _token: TokenInfo): Promise<void> { throw this.createError('CONTENT_REJECTED', 'Hashnode comments are not supported'); }
  async getPostMetrics(_id: string, _token: TokenInfo): Promise<PostMetricsResult> { return { likes: 0, shares: 0, comments: 0, fetchedAt: new Date() }; }
  async refreshToken(_token: string): Promise<RefreshResult> { throw this.createError('AUTH_EXPIRED', 'Hashnode PATs do not refresh'); }
  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: this.key(token) }, body: JSON.stringify({ query: '{ me { id username } }' }) });
    const body = (await response.json().catch(() => null)) as { data?: { me?: { id: string } }; errors?: unknown[] } | null;
    return response.ok && Boolean(body?.data?.me?.id) && !body?.errors?.length;
  }
  async deletePost(_id: string, _token: TokenInfo): Promise<void> { throw this.createError('CONTENT_REJECTED', 'Delete is not supported for Hashnode connections'); }
  private key(token: TokenInfo): string { if (!token.accessToken) throw this.createError('AUTH_REVOKED', 'Missing Hashnode PAT'); return token.accessToken; }
}
