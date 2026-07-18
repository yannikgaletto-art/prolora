import { BaseAdapter } from './base-adapter';
import type { CommentParams, MediaAttachment, PostMetricsResult, PublishParams, PublishResult, RefreshResult, TokenInfo, ValidationResult } from './types';

interface DiscordMessage { id: string; channel_id: string }

export class DiscordAdapter extends BaseAdapter {
  readonly platform = 'discord' as const;

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const webhook = new URL(this.webhook(token));
    webhook.searchParams.set('wait', 'true');
    const embeds = (params.media ?? []).filter((media) => media.mimeType.startsWith('image/') && media.signedUrl).slice(0, 10).map((media) => ({ image: { url: media.signedUrl } }));
    const response = await fetch(webhook.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: params.content, embeds, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) throw this.classifyHttpError(response.status, await response.text());
    const message = (await response.json()) as DiscordMessage;
    return {
      platformPostId: message.id,
      platformUrl: `https://discord.com/channels/${typeof params.connectionConfig.guild_id === 'string' ? params.connectionConfig.guild_id : '@me'}/${message.channel_id}/${message.id}`,
      publishedAt: new Date(),
    };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    const result = this.validateTextLength(content, 2000, media?.length, 10);
    if ((media ?? []).some((item) => !item.mimeType.startsWith('image/'))) {
      result.errors.push('Discord webhook publishing currently supports image attachments only');
      result.valid = false;
    }
    return result;
  }

  async postComment(_params: CommentParams, _token: TokenInfo): Promise<void> {
    throw this.createError('CONTENT_REJECTED', 'Discord webhook connections do not support threaded comments');
  }

  async getPostMetrics(_id: string, _token: TokenInfo): Promise<PostMetricsResult> {
    return { likes: 0, shares: 0, comments: 0, fetchedAt: new Date() };
  }

  async refreshToken(_token: string): Promise<RefreshResult> {
    throw this.createError('AUTH_EXPIRED', 'Discord webhooks do not refresh');
  }

  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    const response = await fetch(this.webhook(token));
    return response.ok;
  }

  async deletePost(platformPostId: string, token: TokenInfo): Promise<void> {
    const webhook = new URL(this.webhook(token));
    webhook.search = '';
    webhook.pathname = `${webhook.pathname.replace(/\/$/, '')}/messages/${encodeURIComponent(platformPostId)}`;
    const response = await fetch(webhook.toString(), { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw this.classifyHttpError(response.status, await response.text());
  }

  private webhook(token: TokenInfo): string {
    if (!token.accessToken) throw this.createError('AUTH_REVOKED', 'Missing Discord webhook URL');
    return token.accessToken;
  }
}
