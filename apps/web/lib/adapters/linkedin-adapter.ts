import { BaseAdapter } from './base-adapter';
import type {
  PublishParams, PublishResult, MediaAttachment,
  PostMetricsResult, CommentParams, TokenInfo,
  RefreshResult, ValidationResult,
} from './types';

const API = 'https://api.linkedin.com';
// LinkedIn rejects sunset Marketing API versions. Keep this aligned with the
// newest supported monthly version from LinkedIn's versioning documentation.
const LINKEDIN_VERSION = '202606';

export class LinkedInAdapter extends BaseAdapter {
  readonly platform = 'linkedin' as const;

  // OAuth 2.0 3-legged, refresh token valid 365 days
  // REST API (NOT legacy v2 UGC): /rest/posts, /rest/images, /rest/socialActions
  // Media: initializeUpload → PUT binary → create post with image URN
  // Rate limit: 150 API calls/day per user token

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const author = this.resolveAuthorUrn(params.connectionConfig);
    const images = (params.media ?? []).filter((m) => m.mimeType.startsWith('image/')).slice(0, 9);

    const body: Record<string, unknown> = {
      author,
      commentary: escapeLittleText(params.content),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (images.length === 1) {
      const imageUrn = await this.uploadImage(author, images[0], token);
      body.content = {
        media: { id: imageUrn, ...(images[0].altText ? { altText: images[0].altText } : {}) },
      };
    } else if (images.length > 1) {
      const uploaded: Array<{ id: string; altText?: string }> = [];
      for (const image of images) {
        const imageUrn = await this.uploadImage(author, image, token);
        uploaded.push({ id: imageUrn, ...(image.altText ? { altText: image.altText } : {}) });
      }
      body.content = { multiImage: { images: uploaded } };
    }

    let response: Response;
    try {
      response = await fetch(`${API}/rest/posts`, {
        method: 'POST',
        headers: this.headers(token, true),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Post request failed', true, undefined, error);
    }

    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    // The post URN comes back in the x-restli-id header, not the body.
    const postUrn = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id');
    if (!postUrn) {
      throw this.createError('UNKNOWN', 'LinkedIn returned no post URN (x-restli-id header missing)');
    }

    return {
      platformPostId: postUrn,
      platformUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`,
      publishedAt: new Date(),
    };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    return this.validateTextLength(content, 3000, media?.length, 9);
  }

  async postComment(params: CommentParams, token: TokenInfo): Promise<void> {
    const author = this.resolveAuthorUrn(params.connectionConfig ?? {});
    let response: Response;
    try {
      response = await fetch(
        `${API}/rest/socialActions/${encodeURIComponent(params.postId)}/comments`,
        {
          method: 'POST',
          headers: this.headers(token, true),
          body: JSON.stringify({
            actor: author,
            message: { text: params.content },
          }),
        }
      );
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Comment request failed', true, undefined, error);
    }
    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }
  }

  async getPostMetrics(_platformPostId: string, _token: TokenInfo): Promise<PostMetricsResult> {
    // organizationalEntityShareStatistics works ONLY for company pages.
    // Personal profiles (the MVP account type) have no official metrics
    // endpoint — return zeros; the dashboard flags this platform limitation.
    return { likes: 0, shares: 0, comments: 0, fetchedAt: new Date() };
  }

  async refreshToken(refreshToken: string): Promise<RefreshResult> {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw this.createError('UNKNOWN', 'LINKEDIN_CLIENT_ID/SECRET not configured');
    }

    let response: Response;
    try {
      response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Token refresh request failed', true, undefined, error);
    }

    const body = await response.text();
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw this.createError('AUTH_REVOKED', `Refresh token rejected: ${body.slice(0, 200)}`);
      }
      throw this.classifyHttpError(response.status, body);
    }

    const json = JSON.parse(body) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (!json.access_token || !json.expires_in) {
      throw this.createError('UNKNOWN', 'Refresh response missing access_token/expires_in');
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(`${API}/v2/userinfo`, {
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
      response = await fetch(`${API}/rest/posts/${encodeURIComponent(platformPostId)}`, {
        method: 'DELETE',
        headers: this.headers(token, false),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Delete request failed', true, undefined, error);
    }
    if (!response.ok && response.status !== 404) {
      throw await this.errorFromResponse(response);
    }
  }

  // --- internals ---

  private headers(token: TokenInfo, withJson: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${token.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': LINKEDIN_VERSION,
      ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private resolveAuthorUrn(config: Record<string, unknown>): string {
    const urn = typeof config.member_urn === 'string' ? config.member_urn : undefined;
    if (!urn) {
      throw this.createError(
        'AUTH_REVOKED',
        'Connection config is missing member_urn — user must reconnect'
      );
    }
    return urn;
  }

  // Two-step image upload: initializeUpload -> PUT bytes -> image URN.
  private async uploadImage(
    ownerUrn: string,
    media: MediaAttachment,
    token: TokenInfo
  ): Promise<string> {
    if (!media.signedUrl) {
      throw this.createError('UNKNOWN', `Media ${media.storageKey} has no signed URL`);
    }

    let initResponse: Response;
    try {
      initResponse = await fetch(`${API}/rest/images?action=initializeUpload`, {
        method: 'POST',
        headers: this.headers(token, true),
        body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Image upload init failed', true, undefined, error);
    }
    if (!initResponse.ok) {
      throw await this.errorFromResponse(initResponse);
    }

    const init = (await initResponse.json()) as {
      value?: { uploadUrl?: string; image?: string };
    };
    if (!init.value?.uploadUrl || !init.value.image) {
      throw this.createError('UNKNOWN', 'initializeUpload returned no uploadUrl/image URN');
    }

    const download = await fetch(media.signedUrl);
    if (!download.ok) {
      throw this.createError('UNKNOWN', `Media download returned HTTP ${download.status}`);
    }
    const bytes = await download.arrayBuffer();

    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(init.value.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': media.mimeType,
        },
        body: bytes,
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Image byte upload failed', true, undefined, error);
    }
    if (!uploadResponse.ok) {
      throw this.classifyHttpError(uploadResponse.status, await uploadResponse.text());
    }

    return init.value.image;
  }

  private async errorFromResponse(response: Response): Promise<Error> {
    const text = await response.text();
    if (response.status === 422) {
      return this.createError('CONTENT_REJECTED', `LinkedIn rejected the post: ${text.slice(0, 200)}`);
    }
    return this.classifyHttpError(response.status, text);
  }
}

// LinkedIn "little text format": these characters are reserved in the
// commentary field and must be backslash-escaped or the API 400s.
function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);
}
