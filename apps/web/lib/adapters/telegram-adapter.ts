import { BaseAdapter } from './base-adapter';
import type {
  PublishParams, PublishResult, MediaAttachment,
  PostMetricsResult, CommentParams, TokenInfo,
  RefreshResult, ValidationResult,
} from './types';

const CAPTION_LIMIT = 1024;

interface TelegramMessage {
  message_id: number;
  chat: { id: number; username?: string };
}

export class TelegramAdapter extends BaseAdapter {
  readonly platform = 'telegram' as const;

  // Bot Token auth (never expires, no refresh needed)
  // Bot API: /bot{token}/sendMessage, sendPhoto, sendDocument
  // chat_id from connection config (channel or group)
  // Rate limit: 30 messages/second to different chats, 1/second to same chat

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const botToken = this.requireBotToken(token);
    const chatId = this.resolveChatId(token, params.connectionConfig);
    const text = escapeHtml(params.content);
    const media = params.media ?? [];

    let message: TelegramMessage;

    if (media.length === 0) {
      message = await this.call<TelegramMessage>(botToken, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      });
    } else if (media.length === 1) {
      message = await this.sendSingleMedia(botToken, chatId, media[0], text);
    } else {
      message = await this.sendMediaGroup(botToken, chatId, media, text);
    }

    return {
      platformPostId: `${message.chat.id}:${message.message_id}`,
      platformUrl: buildMessageUrl(message),
      publishedAt: new Date(),
    };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    const result = this.validateTextLength(content, 4096, media?.length, 10);
    if ((media?.length ?? 0) > 0 && content.length > CAPTION_LIMIT) {
      result.warnings.push(
        `Caption limit is ${CAPTION_LIMIT} chars — text will be sent as a separate message`
      );
    }
    return result;
  }

  async postComment(params: CommentParams, token: TokenInfo): Promise<void> {
    const botToken = this.requireBotToken(token);
    const { chatId, messageId } = parsePostId(params.postId);
    await this.call<TelegramMessage>(botToken, 'sendMessage', {
      chat_id: chatId,
      text: escapeHtml(params.content),
      parse_mode: 'HTML',
      reply_to_message_id: messageId,
    });
  }

  async getPostMetrics(_platformPostId: string, _token: TokenInfo): Promise<PostMetricsResult> {
    // The Bot API exposes no metrics — return zeros so the pipeline stays
    // uniform. The dashboard communicates "metrics unavailable for Telegram".
    return { likes: 0, shares: 0, comments: 0, fetchedAt: new Date() };
  }

  async refreshToken(_refreshToken: string): Promise<RefreshResult> {
    throw this.createError('AUTH_EXPIRED', 'Telegram bot tokens do not expire or refresh');
  }

  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    if (!token.botToken) {
      throw this.createError('AUTH_REVOKED', 'Missing bot token');
    }
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token.botToken}/getMe`);
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Credential check request failed', true, undefined, error);
    }
    if (response.status === 401 || response.status === 404) return false;
    if (!response.ok) {
      throw this.classifyHttpError(response.status, await response.text());
    }
    const json = (await response.json()) as { ok?: boolean };
    return json.ok === true;
  }

  async deletePost(platformPostId: string, token: TokenInfo): Promise<void> {
    const botToken = this.requireBotToken(token);
    const { chatId, messageId } = parsePostId(platformPostId);
    await this.call<boolean>(botToken, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  // --- internals ---

  private requireBotToken(token: TokenInfo): string {
    if (!token.botToken) {
      throw this.createError('AUTH_REVOKED', 'Missing bot token');
    }
    return token.botToken;
  }

  private resolveChatId(token: TokenInfo, config: Record<string, unknown>): string {
    const fromConfig =
      typeof config.chat_id === 'string' || typeof config.chat_id === 'number'
        ? String(config.chat_id)
        : undefined;
    const chatId = token.chatId ?? fromConfig;
    if (!chatId) {
      throw this.createError('CONTENT_REJECTED', 'Connection has no chat_id configured');
    }
    return chatId;
  }

  private async sendSingleMedia(
    botToken: string,
    chatId: string,
    media: MediaAttachment,
    text: string
  ): Promise<TelegramMessage> {
    const url = this.requireSignedUrl(media);
    const method = media.mimeType.startsWith('video/')
      ? 'sendVideo'
      : media.mimeType.startsWith('image/')
        ? 'sendPhoto'
        : 'sendDocument';
    const field = method === 'sendVideo' ? 'video' : method === 'sendPhoto' ? 'photo' : 'document';

    const fitsCaption = text.length <= CAPTION_LIMIT;
    const message = await this.call<TelegramMessage>(botToken, method, {
      chat_id: chatId,
      [field]: url,
      ...(fitsCaption && text ? { caption: text, parse_mode: 'HTML' } : {}),
    });

    // Caption too long: media first, full text as follow-up message.
    if (!fitsCaption && text) {
      await this.call<TelegramMessage>(botToken, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_to_message_id: message.message_id,
      });
    }
    return message;
  }

  private async sendMediaGroup(
    botToken: string,
    chatId: string,
    media: MediaAttachment[],
    text: string
  ): Promise<TelegramMessage> {
    const items = media.slice(0, 10).map((m, index) => ({
      type: m.mimeType.startsWith('video/') ? 'video' : 'photo',
      media: this.requireSignedUrl(m),
      ...(index === 0 && text && text.length <= CAPTION_LIMIT
        ? { caption: text, parse_mode: 'HTML' }
        : {}),
    }));

    const messages = await this.call<TelegramMessage[]>(botToken, 'sendMediaGroup', {
      chat_id: chatId,
      media: items,
    });
    const first = messages[0];
    if (!first) {
      throw this.createError('UNKNOWN', 'sendMediaGroup returned no messages');
    }

    if (text && text.length > CAPTION_LIMIT) {
      await this.call<TelegramMessage>(botToken, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        reply_to_message_id: first.message_id,
      });
    }
    return first;
  }

  private requireSignedUrl(media: MediaAttachment): string {
    if (!media.signedUrl) {
      throw this.createError(
        'UNKNOWN',
        `Media ${media.storageKey} has no signed URL — publish job must resolve it first`
      );
    }
    return media.signedUrl;
  }

  private async call<T>(botToken: string, method: string, body: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', `${method} request failed`, true, undefined, error);
    }

    const json = (await response.json().catch(() => null)) as
      | { ok: boolean; result?: T; description?: string; parameters?: { retry_after?: number } }
      | null;

    if (json?.ok && json.result !== undefined) {
      return json.result;
    }

    const description = json?.description ?? `HTTP ${response.status}`;
    if (response.status === 401 || response.status === 404) {
      throw this.createError('AUTH_REVOKED', `Bot token rejected: ${description}`);
    }
    if (response.status === 429) {
      const retryAfter = json?.parameters?.retry_after;
      throw this.createError(
        'RATE_LIMITED',
        description,
        true,
        retryAfter ? new Date(Date.now() + retryAfter * 1000) : undefined
      );
    }
    if (response.status === 400 || response.status === 403) {
      throw this.createError('CONTENT_REJECTED', description);
    }
    throw this.classifyHttpError(response.status, description);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parsePostId(platformPostId: string): { chatId: string; messageId: number } {
  const separator = platformPostId.lastIndexOf(':');
  if (separator === -1) {
    throw new Error(`Invalid Telegram post id: ${platformPostId}`);
  }
  return {
    chatId: platformPostId.slice(0, separator),
    messageId: Number(platformPostId.slice(separator + 1)),
  };
}

function buildMessageUrl(message: TelegramMessage): string {
  if (message.chat.username) {
    return `https://t.me/${message.chat.username}/${message.message_id}`;
  }
  // Supergroups/channels: -100xxxxxxxxxx -> t.me/c/xxxxxxxxxx/msg
  const idString = String(message.chat.id);
  if (idString.startsWith('-100')) {
    return `https://t.me/c/${idString.slice(4)}/${message.message_id}`;
  }
  return '';
}
