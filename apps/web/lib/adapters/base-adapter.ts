import type { PlatformType } from '@prolora/shared';
import type {
  PlatformAdapter,
  PublishParams,
  PublishResult,
  MediaAttachment,
  PostMetricsResult,
  CommentParams,
  TokenInfo,
  RefreshResult,
  ValidationResult,
  RateLimitInfo,
} from './types';
import { PlatformError } from './types';

export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly platform: PlatformType;

  abstract publish(params: PublishParams, token: TokenInfo): Promise<PublishResult>;
  abstract validateContent(content: string, media?: MediaAttachment[]): ValidationResult;
  abstract postComment(params: CommentParams, token: TokenInfo): Promise<void>;
  abstract getPostMetrics(platformPostId: string, token: TokenInfo): Promise<PostMetricsResult>;
  abstract refreshToken(refreshToken: string): Promise<RefreshResult>;
  abstract verifyCredentials(token: TokenInfo): Promise<boolean>;
  abstract deletePost(platformPostId: string, token: TokenInfo): Promise<void>;

  async getRateLimits(_token: TokenInfo): Promise<RateLimitInfo | null> {
    return null;
  }

  protected createError(
    type: PlatformError['type'],
    message: string,
    retryable = false,
    retryAfter?: Date,
    originalError?: unknown
  ): PlatformError {
    return new PlatformError(type, this.platform, message, retryable, retryAfter, originalError);
  }

  protected classifyHttpError(status: number, body?: string): PlatformError {
    if (status === 401) {
      return this.createError('AUTH_EXPIRED', 'Access token expired or invalid');
    }
    if (status === 403) {
      return this.createError('AUTH_REVOKED', 'Access revoked or insufficient permissions');
    }
    if (status === 429) {
      return this.createError('RATE_LIMITED', 'Rate limit exceeded', true);
    }
    if (status >= 500) {
      return this.createError('PLATFORM_DOWN', `Platform returned ${status}`, true);
    }
    return this.createError('UNKNOWN', `HTTP ${status}: ${body?.slice(0, 200) ?? 'unknown error'}`);
  }

  protected validateTextLength(
    content: string,
    limit: number,
    mediaCount = 0,
    maxMedia = 4
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const characterCount = content.length;

    if (characterCount > limit) {
      errors.push(`Content exceeds ${limit} character limit (${characterCount})`);
    }
    if (characterCount > limit * 0.95) {
      warnings.push('Content is close to the character limit');
    }
    if (mediaCount > maxMedia) {
      errors.push(`Maximum ${maxMedia} media attachments allowed`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      characterCount,
      characterLimit: limit,
    };
  }
}
