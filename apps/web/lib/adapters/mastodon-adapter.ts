import { BaseAdapter } from './base-adapter';
import type {
  PublishParams, PublishResult, MediaAttachment,
  PostMetricsResult, CommentParams, TokenInfo,
  RefreshResult, ValidationResult,
} from './types';

const MEDIA_POLL_ATTEMPTS = 10;
const MEDIA_POLL_INTERVAL_MS = 3000;

interface MastodonStatus {
  id: string;
  url?: string;
  uri?: string;
  reblogs_count?: number;
  favourites_count?: number;
  replies_count?: number;
}

export class MastodonAdapter extends BaseAdapter {
  readonly platform = 'mastodon' as const;

  // OAuth 2.0 per-instance (client registered per instance!)
  // POST /api/v1/statuses
  // Media: POST /api/v2/media → async processing (202) → poll until ready
  // Rate limit: 300 requests/5min (varies by instance)
  // Instance URL stored in connection config — NEVER from ENV.

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const instanceUrl = this.resolveInstanceUrl(token, params.connectionConfig);
    const media = params.media ?? [];

    const mediaIds: string[] = [];
    for (const item of media.slice(0, 4)) {
      mediaIds.push(await this.uploadMedia(instanceUrl, token.accessToken, item));
    }

    const body: Record<string, unknown> = {
      status: params.content,
      visibility: 'public',
      ...(mediaIds.length > 0 ? { media_ids: mediaIds } : {}),
      ...(params.replyToId ? { in_reply_to_id: params.replyToId } : {}),
    };
    // Content warning ONLY when the user explicitly sets it via overrides —
    // never automatically (FABLE-02).
    const spoiler = params.connectionConfig.spoiler_text;
    if (typeof spoiler === 'string' && spoiler.length > 0) {
      body.spoiler_text = spoiler;
    }

    const status = await this.call<MastodonStatus>(
      instanceUrl,
      token.accessToken,
      'POST',
      '/api/v1/statuses',
      body,
      params.idempotencyKey
    );

    return {
      platformPostId: status.id,
      platformUrl: status.url ?? status.uri ?? `${instanceUrl}/web/statuses/${status.id}`,
      publishedAt: new Date(),
    };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    // Default 500 — the validation pipeline overrides with the per-instance
    // limit from connection config (max_characters).
    return this.validateTextLength(content, 500, media?.length, 4);
  }

  async postComment(params: CommentParams, token: TokenInfo): Promise<void> {
    const instanceUrl = this.resolveInstanceUrl(token, params.connectionConfig ?? {});
    await this.call<MastodonStatus>(instanceUrl, token.accessToken, 'POST', '/api/v1/statuses', {
      status: params.content,
      in_reply_to_id: params.postId,
      visibility: 'public',
    });
  }

  async getPostMetrics(platformPostId: string, token: TokenInfo): Promise<PostMetricsResult> {
    const instanceUrl = this.resolveInstanceUrl(token, {});
    const status = await this.call<MastodonStatus>(
      instanceUrl,
      token.accessToken,
      'GET',
      `/api/v1/statuses/${platformPostId}`
    );
    return {
      likes: status.favourites_count ?? 0,
      shares: status.reblogs_count ?? 0,
      comments: status.replies_count ?? 0,
      // Mastodon exposes no impressions.
      fetchedAt: new Date(),
    };
  }

  async refreshToken(_refreshToken: string): Promise<RefreshResult> {
    // Mastodon access tokens never expire (until revoked) — no refresh flow.
    throw this.createError('UNKNOWN', 'Mastodon tokens do not expire — no refresh');
  }

  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    if (!token.instanceUrl) {
      throw this.createError('UNKNOWN', 'Connection is missing instance_url');
    }
    let response: Response;
    try {
      response = await fetch(`${token.instanceUrl}/api/v1/accounts/verify_credentials`, {
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
    const instanceUrl = this.resolveInstanceUrl(token, {});
    await this.call<Record<string, unknown>>(
      instanceUrl,
      token.accessToken,
      'DELETE',
      `/api/v1/statuses/${platformPostId}`
    );
  }

  // --- internals ---

  private resolveInstanceUrl(token: TokenInfo, config: Record<string, unknown>): string {
    const fromConfig = typeof config.instance_url === 'string' ? config.instance_url : undefined;
    const instanceUrl = token.instanceUrl ?? fromConfig;
    if (!instanceUrl) {
      throw this.createError('UNKNOWN', 'Connection is missing instance_url');
    }
    return instanceUrl.replace(/\/$/, '');
  }

  private async uploadMedia(
    instanceUrl: string,
    accessToken: string,
    media: MediaAttachment
  ): Promise<string> {
    if (!media.signedUrl) {
      throw this.createError('UNKNOWN', `Media ${media.storageKey} has no signed URL`);
    }

    const download = await fetch(media.signedUrl);
    if (!download.ok) {
      throw this.createError('UNKNOWN', `Media download returned HTTP ${download.status}`);
    }
    const bytes = await download.arrayBuffer();

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: media.mimeType }), fileNameFor(media.mimeType));
    if (media.altText) form.append('description', media.altText);

    let response: Response;
    try {
      response = await fetch(`${instanceUrl}/api/v2/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Media upload failed', true, undefined, error);
    }

    if (response.status !== 200 && response.status !== 202) {
      throw this.classifyHttpError(response.status, await response.text());
    }

    const json = (await response.json()) as { id?: string; url?: string | null };
    if (!json.id) {
      throw this.createError('UNKNOWN', 'Media upload returned no id');
    }

    // 202 = still processing on this instance -> poll until ready.
    if (response.status === 202 || !json.url) {
      await this.waitForMediaReady(instanceUrl, accessToken, json.id);
    }
    return json.id;
  }

  private async waitForMediaReady(
    instanceUrl: string,
    accessToken: string,
    mediaId: string
  ): Promise<void> {
    for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_INTERVAL_MS));
      const response = await fetch(`${instanceUrl}/api/v1/media/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      // 200 with url = ready; 206 = still processing.
      if (response.status === 200) {
        const json = (await response.json()) as { url?: string | null };
        if (json.url) return;
      } else if (response.status !== 206) {
        throw this.classifyHttpError(response.status, await response.text());
      }
    }
    throw this.createError(
      'PLATFORM_DOWN',
      `Media ${mediaId} was not processed within ${(MEDIA_POLL_ATTEMPTS * MEDIA_POLL_INTERVAL_MS) / 1000}s`,
      true
    );
  }

  private async call<T>(
    instanceUrl: string,
    accessToken: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${instanceUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', `${method} ${path} request failed`, true, undefined, error);
    }

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 422) {
        throw this.createError('CONTENT_REJECTED', `Instance rejected the post: ${text.slice(0, 200)}`);
      }
      throw this.classifyHttpError(response.status, text);
    }
    return (await response.json()) as T;
  }
}

function fileNameFor(mimeType: string): string {
  const ext = mimeType.split('/')[1]?.split('+')[0] ?? 'bin';
  return `upload.${ext}`;
}
