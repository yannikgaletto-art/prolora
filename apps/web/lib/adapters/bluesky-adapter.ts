import { BaseAdapter } from './base-adapter';
import type {
  PublishParams, PublishResult, MediaAttachment,
  PostMetricsResult, CommentParams, TokenInfo,
  RefreshResult, ValidationResult,
} from './types';

const SERVICE = 'https://bsky.social';
const GRAPHEME_LIMIT = 300;
const MAX_IMAGE_BYTES = 1_000_000; // uploadBlob limit ~1MB

interface BskySession {
  did: string;
  handle: string;
  accessJwt: string;
}

interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: Array<
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
    | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  >;
}

export class BlueskyAdapter extends BaseAdapter {
  readonly platform = 'bluesky' as const;

  // App Password auth (no OAuth), AT Protocol via raw XRPC (no SDK dependency)
  // createSession → JWT (accessJwt 2h) — created per operation
  // com.atproto.repo.createRecord for posts
  // Media: com.atproto.repo.uploadBlob (max 1MB images)
  // Rate limit: 1666 points/h, 35000/day (create=3 pts)

  async publish(params: PublishParams, token: TokenInfo): Promise<PublishResult> {
    const session = await this.createSession(token);
    const facets = await this.detectFacets(params.content, session);
    const media = (params.media ?? []).filter((m) => m.mimeType.startsWith('image/')).slice(0, 4);

    let embed: Record<string, unknown> | undefined;
    if (media.length > 0) {
      embed = await this.buildImagesEmbed(media, session);
    } else {
      // No images: if the text links somewhere, attach a link card.
      const firstLink = facets
        .flatMap((f) => f.features)
        .find((f) => f.$type === 'app.bsky.richtext.facet#link');
      if (firstLink && 'uri' in firstLink) {
        embed = await this.buildExternalEmbed(firstLink.uri, session);
      }
    }

    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: params.content,
      createdAt: new Date().toISOString(),
      ...(facets.length > 0 ? { facets } : {}),
      ...(embed ? { embed } : {}),
    };

    if (params.replyToId) {
      record.reply = await this.buildReplyRef(params.replyToId, session);
    }

    const created = await this.xrpc<{ uri: string; cid: string }>(
      session,
      'com.atproto.repo.createRecord',
      {
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }
    );

    const rkey = created.uri.split('/').pop() ?? '';
    return {
      platformPostId: created.uri,
      platformUrl: `https://bsky.app/profile/${session.handle}/post/${rkey}`,
      publishedAt: new Date(),
    };
  }

  validateContent(content: string, media?: MediaAttachment[]): ValidationResult {
    // Bluesky counts GRAPHEMES, not chars/bytes: "Ää" = 2 graphemes.
    const graphemeCount = countGraphemes(content);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (graphemeCount > GRAPHEME_LIMIT) {
      errors.push(`Content exceeds ${GRAPHEME_LIMIT} grapheme limit (${graphemeCount})`);
    } else if (graphemeCount > GRAPHEME_LIMIT * 0.95) {
      warnings.push('Content is close to the grapheme limit');
    }
    if ((media?.length ?? 0) > 4) {
      errors.push('Maximum 4 media attachments allowed');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      characterCount: graphemeCount,
      characterLimit: GRAPHEME_LIMIT,
    };
  }

  async postComment(params: CommentParams, token: TokenInfo): Promise<void> {
    const session = await this.createSession(token);
    const reply = await this.buildReplyRef(params.postId, session);
    const facets = await this.detectFacets(params.content, session);

    await this.xrpc<{ uri: string }>(session, 'com.atproto.repo.createRecord', {
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: params.content,
        createdAt: new Date().toISOString(),
        reply,
        ...(facets.length > 0 ? { facets } : {}),
      },
    });
  }

  async getPostMetrics(platformPostId: string, token: TokenInfo): Promise<PostMetricsResult> {
    const session = await this.createSession(token);
    const thread = await this.xrpcGet<{
      thread: { post?: { likeCount?: number; repostCount?: number; replyCount?: number } };
    }>(session, 'app.bsky.feed.getPostThread', { uri: platformPostId, depth: '0' });

    const post = thread.thread.post;
    return {
      likes: post?.likeCount ?? 0,
      shares: post?.repostCount ?? 0,
      comments: post?.replyCount ?? 0,
      // Bluesky exposes no impressions.
      fetchedAt: new Date(),
    };
  }

  async refreshToken(_refreshToken: string): Promise<RefreshResult> {
    // App passwords never expire; sessions are created on demand from the
    // stored app password. There is nothing to refresh at the DB level.
    throw this.createError('UNKNOWN', 'Bluesky uses app passwords — no token refresh');
  }

  async verifyCredentials(token: TokenInfo): Promise<boolean> {
    if (!token.identifier || !token.appPassword) {
      throw this.createError('AUTH_REVOKED', 'Missing handle or app password');
    }
    let response: Response;
    try {
      response = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: token.identifier, password: token.appPassword }),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Credential check request failed', true, undefined, error);
    }
    if (response.ok) return true;
    if (response.status === 401 || response.status === 400) return false;
    throw this.classifyHttpError(response.status, await response.text());
  }

  async deletePost(platformPostId: string, token: TokenInfo): Promise<void> {
    const session = await this.createSession(token);
    const { rkey } = parseAtUri(platformPostId);
    await this.xrpc<Record<string, unknown>>(session, 'com.atproto.repo.deleteRecord', {
      repo: session.did,
      collection: 'app.bsky.feed.post',
      rkey,
    });
  }

  // --- internals ---

  private async createSession(token: TokenInfo): Promise<BskySession> {
    if (!token.identifier || !token.appPassword) {
      throw this.createError('AUTH_REVOKED', 'Missing handle or app password');
    }
    let response: Response;
    try {
      response = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: token.identifier, password: token.appPassword }),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'createSession request failed', true, undefined, error);
    }
    if (response.status === 401 || response.status === 400) {
      throw this.createError('AUTH_REVOKED', 'App password rejected — user must reconnect');
    }
    if (!response.ok) {
      throw this.classifyHttpError(response.status, await response.text());
    }
    const json = (await response.json()) as Partial<BskySession>;
    if (!json.did || !json.accessJwt || !json.handle) {
      throw this.createError('UNKNOWN', 'createSession returned an incomplete session');
    }
    return { did: json.did, handle: json.handle, accessJwt: json.accessJwt };
  }

  private async xrpc<T>(session: BskySession, method: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${SERVICE}/xrpc/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', `${method} request failed`, true, undefined, error);
    }
    if (!response.ok) {
      throw this.classifyHttpError(response.status, await response.text());
    }
    return (await response.json()) as T;
  }

  private async xrpcGet<T>(
    session: BskySession,
    method: string,
    params: Record<string, string>
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${SERVICE}/xrpc/${method}?${new URLSearchParams(params)}`, {
        headers: { Authorization: `Bearer ${session.accessJwt}` },
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', `${method} request failed`, true, undefined, error);
    }
    if (!response.ok) {
      throw this.classifyHttpError(response.status, await response.text());
    }
    return (await response.json()) as T;
  }

  private async uploadBlob(session: BskySession, bytes: ArrayBuffer, mimeType: string): Promise<BlobRef> {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw this.createError(
        'CONTENT_REJECTED',
        `Image exceeds Bluesky's ${Math.round(MAX_IMAGE_BYTES / 1000)}KB blob limit — transform pipeline should have resized it`
      );
    }
    let response: Response;
    try {
      response = await fetch(`${SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: bytes,
      });
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'uploadBlob request failed', true, undefined, error);
    }
    if (!response.ok) {
      throw this.classifyHttpError(response.status, await response.text());
    }
    const json = (await response.json()) as { blob?: BlobRef };
    if (!json.blob) {
      throw this.createError('UNKNOWN', 'uploadBlob returned no blob ref');
    }
    return json.blob;
  }

  private async buildImagesEmbed(
    media: MediaAttachment[],
    session: BskySession
  ): Promise<Record<string, unknown>> {
    const images: Array<{ image: BlobRef; alt: string }> = [];
    for (const item of media) {
      if (!item.signedUrl) {
        throw this.createError('UNKNOWN', `Media ${item.storageKey} has no signed URL`);
      }
      const bytes = await this.fetchBytes(item.signedUrl);
      const blob = await this.uploadBlob(session, bytes, item.mimeType);
      images.push({ image: blob, alt: item.altText ?? '' });
    }
    return { $type: 'app.bsky.embed.images', images };
  }

  private async buildExternalEmbed(
    url: string,
    session: BskySession
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const og = await fetchOpenGraph(url);
      if (!og) return undefined;

      let thumb: BlobRef | undefined;
      if (og.image) {
        try {
          const bytes = await this.fetchBytes(og.image);
          if (bytes.byteLength <= MAX_IMAGE_BYTES) {
            thumb = await this.uploadBlob(session, bytes, guessImageMime(og.image));
          }
        } catch {
          // Thumb is optional — card still works without it.
        }
      }

      return {
        $type: 'app.bsky.embed.external',
        external: {
          uri: url,
          title: og.title ?? url,
          description: og.description ?? '',
          ...(thumb ? { thumb } : {}),
        },
      };
    } catch (error) {
      // Link cards are best-effort — never fail the post over them.
      console.error('[bluesky-adapter] link card failed:', error);
      return undefined;
    }
  }

  private async buildReplyRef(
    atUri: string,
    session: BskySession
  ): Promise<{ root: { uri: string; cid: string }; parent: { uri: string; cid: string } }> {
    const { repo, rkey } = parseAtUri(atUri);
    const record = await this.xrpcGet<{
      uri: string;
      cid: string;
      value?: { reply?: { root?: { uri: string; cid: string } } };
    }>(session, 'com.atproto.repo.getRecord', {
      repo,
      collection: 'app.bsky.feed.post',
      rkey,
    });

    const parent = { uri: record.uri, cid: record.cid };
    // If the target is itself a reply, thread root stays the original root.
    const root = record.value?.reply?.root ?? parent;
    return { root, parent };
  }

  private async fetchBytes(url: string): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw this.createError('NETWORK_ERROR', 'Media download failed', true, undefined, error);
    }
    if (!response.ok) {
      throw this.createError('UNKNOWN', `Media download returned HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }

  // Detect links, hashtags and mentions with BYTE offsets (UTF-8), as the
  // AT protocol requires. Mentions resolve handle -> DID.
  private async detectFacets(text: string, session: BskySession): Promise<Facet[]> {
    const facets: Facet[] = [];
    const encoder = new TextEncoder();

    const byteIndex = (charIndex: number): number => encoder.encode(text.slice(0, charIndex)).length;

    const urlRegex = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g;
    for (const match of text.matchAll(urlRegex)) {
      const start = match.index ?? 0;
      facets.push({
        index: { byteStart: byteIndex(start), byteEnd: byteIndex(start + match[0].length) },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: match[0] }],
      });
    }

    const tagRegex = /(?:^|\s)(#[^\d\s][^\s#.,;:!?()]*)/g;
    for (const match of text.matchAll(tagRegex)) {
      const tag = match[1];
      const start = (match.index ?? 0) + match[0].indexOf(tag);
      facets.push({
        index: { byteStart: byteIndex(start), byteEnd: byteIndex(start + tag.length) },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag.slice(1) }],
      });
    }

    const mentionRegex = /(?:^|\s)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    for (const match of text.matchAll(mentionRegex)) {
      const mention = match[1];
      const handle = mention.slice(1);
      const did = await this.resolveHandle(session, handle);
      if (!did) continue; // unresolvable mention: leave as plain text
      const start = (match.index ?? 0) + match[0].indexOf(mention);
      facets.push({
        index: { byteStart: byteIndex(start), byteEnd: byteIndex(start + mention.length) },
        features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
      });
    }

    return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
  }

  private async resolveHandle(session: BskySession, handle: string): Promise<string | null> {
    try {
      const result = await this.xrpcGet<{ did?: string }>(
        session,
        'com.atproto.identity.resolveHandle',
        { handle }
      );
      return result.did ?? null;
    } catch {
      return null;
    }
  }
}

function countGraphemes(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } {
  // at://did:plc:xxx/app.bsky.feed.post/rkey
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid AT URI: ${uri}`);
  }
  return { repo: match[1], collection: match[2], rkey: match[3] };
}

interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
}

async function fetchOpenGraph(url: string): Promise<OpenGraphData | null> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Prolora/1.0 (link preview)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const html = (await response.text()).slice(0, 300_000);

  const read = (property: string): string | undefined => {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${property}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtmlEntities(match[1]);
    }
    return undefined;
  };

  const title = read('title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
  return { title, description: read('description'), image: read('image') };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function guessImageMime(url: string): string {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
