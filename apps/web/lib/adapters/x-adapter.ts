import { BaseAdapter } from './base-adapter';
import type {
  PublishParams, PublishResult, MediaAttachment,
  PostMetricsResult, CommentParams, TokenInfo,
  RefreshResult, ValidationResult, RateLimitInfo,
} from './types';

const API = 'https://api.twitter.com';
const UPLOAD_API = 'https://upload.twitter.com/1.1/media/upload.json';
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB APPEND chunks
const SIMPLE_UPLOAD_LIMIT = 5 * 1024 * 1024; // >5MB -> chunked

interface TweetResponse {
  data?: { id: string; text: string };
}

export class XAdapter extends BaseAdapter {
  readonly platform = 'x' as const;

  // OAuth 2.0 PKCE, SINGLE-USE refresh tokens (critical!)
  // Tweets: v2 API. Media upload: STILL v1.1 (API version mix is intentional).
  // Rate limit: 17 posts/15min (Free tier) — the strictest of all platforms.

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const media = (params.media ?? []).slice(0, 4);
    const mediaIds: string[] = [];
    for (const item of media) {
      mediaIds.push(await this.uploadMedia(item, token));
    }

    const body: Record<string, unknown> = {
      text: params.content,
      ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
      ...(params.replyToId ? { reply: { in_reply_to_tweet_id: params.replyToId } } : {}),
    };

    const { json, rateLimit } = await this.tweetCall(body, token);
    const tweetId = json.data?.id;
    if (!tweetId) {
      throw this.createError('UNKNOWN', 'Tweet response contained no id');
    }

    const username =
      typeof params.connectionConfig.username === 'string'
        ? params.connectionConfig.username
        : 'i/web';

    return {
      platformPostId: tweetId,
      platformUrl:
        username === 'i/web'
          ? `https://twitter.com/i/web/status/${tweetId}`
          : `https://x.com/${username}/status/${tweetId}`,
      publishedAt: new Date(),
      rateLimit,
    };
  }

  // Threads post SEQUENTIALLY — each tweet replies to the previous one.
  // Exposed for future thread support in the API contract.
  async publishThread(
    texts: string[],
    token: TokenInfo,
    connectionConfig: Record<string, unknown>
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    let previousId: string | undefined;

    for (const text of texts) {
      const result = await this.publish(
        { content: text, connectionConfig, replyToId: previousId },
        token
      );
      previousId = result.platformPostId;
      results.push(result);
    }
    return results;
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    return this.validateTextLength(content, 280, media?.length, 4);
  }

  async postComment(params: CommentParams, token: TokenInfo): Promise<void> {
    const { json } = await this.tweetCall(
      {
        text: params.content,
        reply: { in_reply_to_tweet_id: params.postId },
      },
      token
    );
    if (!json.data?.id) {
      throw this.createError('UNKNOWN', 'Reply tweet response contained no id');
    }
  }

  async getPostMetrics(platformPostId: string, token: TokenInfo): Promise<PostMetricsResult> {
    let response: Response;
    try {
      response = await fetch(
        `${API}/2/tweets/${platformPostId}?tweet.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Metrics request failed', true, undefined, error);
    }
    if (!response.ok) {
      throw this.classifyHttpError(response.status, await response.text());
    }

    const json = (await response.json()) as {
      data?: {
        public_metrics?: {
          like_count?: number;
          retweet_count?: number;
          quote_count?: number;
          reply_count?: number;
          impression_count?: number;
        };
      };
    };
    const metrics = json.data?.public_metrics;
    return {
      likes: metrics?.like_count ?? 0,
      shares: (metrics?.retweet_count ?? 0) + (metrics?.quote_count ?? 0),
      comments: metrics?.reply_count ?? 0,
      impressions: metrics?.impression_count,
      fetchedAt: new Date(),
    };
  }

  async refreshToken(refreshToken: string): Promise<RefreshResult> {
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw this.createError('UNKNOWN', 'X_CLIENT_ID/SECRET not configured');
    }

    let response: Response;
    try {
      response = await fetch(`${API}/2/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Token refresh request failed', true, undefined, error);
    }

    const body = await response.text();
    if (!response.ok) {
      // 400 invalid_request / invalid_grant = refresh token consumed or revoked.
      // Single-use tokens: this is unrecoverable, user must reconnect.
      if (response.status === 400 || response.status === 401) {
        throw this.createError('AUTH_REVOKED', `Refresh token rejected: ${body.slice(0, 200)}`);
      }
      throw this.classifyHttpError(response.status, body);
    }

    const json = JSON.parse(body) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!json.access_token || !json.refresh_token || !json.expires_in) {
      throw this.createError('UNKNOWN', 'Refresh response missing token fields');
    }

    // The NEW refresh token MUST be persisted by the caller immediately —
    // the old one is now dead (single-use).
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(`${API}/2/users/me`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Credential check request failed', true, undefined, error);
    }
    if (response.ok) return true;
    if (response.status === 401 || response.status === 403) return false;
    throw this.classifyHttpError(response.status, await response.text());
  }

  async deletePost(platformPostId: string, token: TokenInfo): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${API}/2/tweets/${platformPostId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Delete request failed', true, undefined, error);
    }
    if (!response.ok && response.status !== 404) {
      throw this.classifyHttpError(response.status, await response.text());
    }
  }

  // --- internals ---

  private async tweetCall(
    body: Record<string, unknown>,
    token: TokenInfo
  ): Promise<{ json: TweetResponse; rateLimit: RateLimitInfo | null }> {
    let response: Response;
    try {
      response = await fetch(`${API}/2/tweets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Tweet request failed', true, undefined, error);
    }

    const rateLimit = extractRateLimit(response);

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 429) {
        throw this.createError(
          'RATE_LIMITED',
          'Tweet rate limit exceeded (17/15min on Free tier)',
          true,
          rateLimit?.resetsAt
        );
      }
      if (response.status === 403) {
        // 403 on tweets is usually duplicate content / forbidden content,
        // not a permission problem.
        throw this.createError('CONTENT_REJECTED', `X rejected the tweet: ${text.slice(0, 200)}`);
      }
      throw this.classifyHttpError(response.status, text);
    }

    return { json: (await response.json()) as TweetResponse, rateLimit };
  }

  // Media upload uses the v1.1 endpoint (works with OAuth 2.0 user-context
  // Bearer tokens). Images: simple base64 upload. Videos >5MB: chunked
  // INIT -> APPEND -> FINALIZE (+ STATUS poll while processing).
  private async uploadMedia(media: MediaAttachment, token: TokenInfo): Promise<string> {
    if (!media.signedUrl) {
      throw this.createError('UNKNOWN', `Media ${media.storageKey} has no signed URL`);
    }
    const download = await fetch(media.signedUrl);
    if (!download.ok) {
      throw this.createError('UNKNOWN', `Media download returned HTTP ${download.status}`);
    }
    const bytes = Buffer.from(await download.arrayBuffer());

    const isVideo = media.mimeType.startsWith('video/');
    if (isVideo || bytes.length > SIMPLE_UPLOAD_LIMIT) {
      return this.chunkedUpload(bytes, media.mimeType, token, isVideo);
    }
    return this.simpleUpload(bytes, token);
  }

  private async simpleUpload(bytes: Buffer, token: TokenInfo): Promise<string> {
    const form = new URLSearchParams({ media_data: bytes.toString('base64') });
    const response = await this.uploadCall(form, token);
    const json = (await response.json()) as { media_id_string?: string };
    if (!json.media_id_string) {
      throw this.createError('UNKNOWN', 'Media upload returned no media_id');
    }
    return json.media_id_string;
  }

  private async chunkedUpload(
    bytes: Buffer,
    mimeType: string,
    token: TokenInfo,
    isVideo: boolean
  ): Promise<string> {
    // INIT
    const initForm = new URLSearchParams({
      command: 'INIT',
      total_bytes: String(bytes.length),
      media_type: mimeType,
      ...(isVideo ? { media_category: 'tweet_video' } : {}),
    });
    const initJson = (await (await this.uploadCall(initForm, token)).json()) as {
      media_id_string?: string;
    };
    const mediaId = initJson.media_id_string;
    if (!mediaId) {
      throw this.createError('UNKNOWN', 'Chunked upload INIT returned no media_id');
    }

    // APPEND (4MB chunks, sequential)
    for (let segment = 0; segment * CHUNK_SIZE < bytes.length; segment++) {
      const chunk = bytes.subarray(segment * CHUNK_SIZE, (segment + 1) * CHUNK_SIZE);
      const appendForm = new URLSearchParams({
        command: 'APPEND',
        media_id: mediaId,
        segment_index: String(segment),
        media_data: chunk.toString('base64'),
      });
      await this.uploadCall(appendForm, token);
    }

    // FINALIZE
    const finalizeForm = new URLSearchParams({ command: 'FINALIZE', media_id: mediaId });
    const finalizeJson = (await (await this.uploadCall(finalizeForm, token)).json()) as {
      processing_info?: { state: string; check_after_secs?: number };
    };

    // STATUS poll while the platform transcodes the video.
    let processing = finalizeJson.processing_info;
    let attempts = 0;
    while (processing && processing.state !== 'succeeded') {
      if (processing.state === 'failed') {
        throw this.createError('CONTENT_REJECTED', 'X rejected the video during processing');
      }
      if (attempts++ > 30) {
        throw this.createError(
          'PRECOMMIT_RETRYABLE',
          'Video processing timed out before tweet creation',
          true
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, (processing?.check_after_secs ?? 2) * 1000)
      );
      const statusResponse = await fetch(
        `${UPLOAD_API}?command=STATUS&media_id=${mediaId}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (!statusResponse.ok) {
        throw this.classifyHttpError(statusResponse.status, await statusResponse.text());
      }
      const statusJson = (await statusResponse.json()) as {
        processing_info?: { state: string; check_after_secs?: number };
      };
      processing = statusJson.processing_info;
    }

    return mediaId;
  }

  private async uploadCall(form: URLSearchParams, token: TokenInfo): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(UPLOAD_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Media upload request failed', true, undefined, error);
    }
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 400 || response.status === 415) {
        throw this.createError('CONTENT_REJECTED', `X rejected the media: ${text.slice(0, 200)}`);
      }
      throw this.classifyHttpError(response.status, text);
    }
    return response;
  }
}

function extractRateLimit(response: Response): RateLimitInfo | null {
  const remaining = response.headers.get('x-rate-limit-remaining');
  const limit = response.headers.get('x-rate-limit-limit');
  const reset = response.headers.get('x-rate-limit-reset');
  if (remaining === null || limit === null || reset === null) return null;
  return {
    remaining: Number(remaining),
    limit: Number(limit),
    resetsAt: new Date(Number(reset) * 1000),
  };
}
