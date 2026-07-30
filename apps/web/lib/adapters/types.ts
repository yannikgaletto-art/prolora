import type { PlatformType } from '@prolora/shared';

export interface PublishParams {
  content: string;
  media?: MediaAttachment[];
  replyToId?: string;
  connectionConfig: Record<string, unknown>;
  /** Stable key (post_item id) so platform-side dedupe can catch job retries */
  idempotencyKey?: string;
}

export interface PublishResult {
  platformPostId: string;
  platformUrl: string;
  publishedAt: Date;
  /** Rate-limit state parsed from response headers, if the platform sends it */
  rateLimit?: RateLimitInfo | null;
}

export interface MediaAttachment {
  storageKey: string;
  mimeType: string;
  altText?: string;
  /** Fresh signed URL, resolved by the publish job at publish time (R2) */
  signedUrl?: string;
}

export interface PostMetricsResult {
  likes: number;
  shares: number;
  comments: number;
  impressions?: number;
  clicks?: number;
  fetchedAt: Date;
}

export interface CommentParams {
  postId: string;
  content: string;
  /** Connection config for platforms that need routing info (e.g. Telegram chat_id) */
  connectionConfig?: Record<string, unknown>;
}

export interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  appPassword?: string;
  botToken?: string;
  /** Bluesky handle or DID (needed for createSession) */
  identifier?: string;
  /** Mastodon instance base URL, e.g. "https://mastodon.social" */
  instanceUrl?: string;
  /** Telegram target chat id (may be negative for groups/channels) */
  chatId?: string;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  characterCount: number;
  characterLimit: number;
}

export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetsAt: Date;
}

export type PlatformErrorType =
  | 'AUTH_EXPIRED'
  | 'AUTH_REVOKED'
  | 'RATE_LIMITED'
  | 'CONTENT_REJECTED'
  /** Adapter proved the failure happened before the external create request. */
  | 'PRECOMMIT_RETRYABLE'
  | 'PLATFORM_DOWN'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class PlatformError extends Error {
  constructor(
    public readonly type: PlatformErrorType,
    public readonly platform: PlatformType,
    message: string,
    public readonly retryable: boolean = false,
    public readonly retryAfter?: Date,
    public readonly originalError?: unknown
  ) {
    super(`[${platform}] ${message}`);
    this.name = 'PlatformError';
  }
}

export interface PlatformAdapter {
  readonly platform: PlatformType;

  publish(params: PublishParams, token: TokenInfo): Promise<PublishResult>;

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult;

  postComment(params: CommentParams, token: TokenInfo): Promise<void>;

  getPostMetrics(platformPostId: string, token: TokenInfo): Promise<PostMetricsResult>;

  refreshToken(refreshToken: string): Promise<RefreshResult>;

  verifyCredentials(token: TokenInfo): Promise<boolean>;

  getRateLimits(token: TokenInfo): Promise<RateLimitInfo | null>;

  deletePost(platformPostId: string, token: TokenInfo): Promise<void>;
}
