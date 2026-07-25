// Reddit API wrapper — Application-Only auth (client_credentials).
// Prolora reads Reddit with a registered app key. It NEVER acts as the user and
// NEVER creates posts or comments (Invarianten D1/D2).
//
// This module deliberately knows nothing about where credentials are stored:
// it is handed a resolved pair. Resolution (workspace row -> env fallback)
// lives in lib/integrations/reddit-credentials.ts, which imports from here —
// putting the lookup in this file instead would make that a cycle.

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';
const USER_AGENT = 'web:prolora:v1.0 (DACH feedback & publishing SaaS)';

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Keyed by client_id: two workspaces with different Reddit apps must never
// share a token. (The previous module-level single cache would have handed
// workspace B the token minted with workspace A's credentials.)
const tokenCache = new Map<string, CachedToken>();

/**
 * One client_credentials round-trip. Exported so the setup UI can verify a
 * pasted key pair against Reddit *before* anything is persisted.
 */
export async function requestRedditToken(
  credentials: RedditCredentials
): Promise<{ accessToken: string; expiresIn: number }> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 401) {
    throw new Error('Reddit rejected these credentials (401). Check client ID and secret.');
  }
  if (response.status === 429) {
    throw new Error('Reddit rate limit hit while verifying. Try again in a minute.');
  }
  if (!response.ok) {
    throw new Error(`Reddit token request failed: HTTP ${response.status}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    // Reddit answers 200 with {"error":"invalid_grant"} when the app type is
    // wrong — "script" apps cannot use client_credentials, "web app" can.
    throw new Error(
      'Reddit returned no access token. Make sure the app type is "web app" or "script" and the secret is current.'
    );
  }
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 86400 };
}

export interface RedditSubreddit {
  display_name: string;
  title: string;
  url: string;
  subscribers: number;
  active_user_count: number | null;
  public_description: string;
  over18: boolean;
  lang: string | null;
}

export interface RedditThread {
  id: string;
  fullname: string; // t3_xxx
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  permalink: string;
  created_utc: number;
  score: number;
  num_comments: number;
}

export interface RedditRule {
  short_name: string;
  description: string;
}

export class RedditClient {
  constructor(private readonly credentials: RedditCredentials) {}

  // Token lives 24h — cache and refresh 5 minutes early.
  private async getToken(): Promise<string> {
    const cacheKey = this.credentials.clientId;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.accessToken;
    }

    const { accessToken, expiresIn } = await requestRedditToken(this.credentials);
    tokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    });
    return accessToken;
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getToken();
    const query = params ? `?${new URLSearchParams(params)}` : '';
    const response = await fetch(`${API}${path}${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) {
      throw new Error('Reddit rate limit exceeded (100 req/min app-level)');
    }
    if (!response.ok) {
      throw new Error(`Reddit API ${path} returned HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  // GET /subreddits/search — discovery by topic
  async searchSubreddits(topic: string, limit = 25): Promise<RedditSubreddit[]> {
    const json = await this.get<{
      data?: { children?: Array<{ data: Record<string, unknown> }> };
    }>('/subreddits/search', { q: topic, limit: String(limit), sort: 'relevance' });
    return (json.data?.children ?? []).map((child) => mapSubreddit(child.data));
  }

  // GET /r/{sub}/about
  async getSubredditAbout(subreddit: string): Promise<RedditSubreddit> {
    const json = await this.get<{ data?: Record<string, unknown> }>(
      `/r/${encodeURIComponent(subreddit)}/about`
    );
    if (!json.data) throw new Error(`Subreddit r/${subreddit} not found`);
    return mapSubreddit(json.data);
  }

  // GET /r/{sub}/about/rules
  async getSubredditRules(subreddit: string): Promise<RedditRule[]> {
    const json = await this.get<{
      rules?: Array<{ short_name?: string; description?: string }>;
    }>(`/r/${encodeURIComponent(subreddit)}/about/rules`);
    return (json.rules ?? []).map((rule) => ({
      short_name: rule.short_name ?? '',
      description: rule.description ?? '',
    }));
  }

  // GET /r/{sub}/search — keyword search, newest first (Stage 1 of the
  // two-stage Thread Radar filter)
  async searchThreads(
    subreddit: string,
    query: string,
    options?: { time?: 'hour' | 'day' | 'week'; limit?: number }
  ): Promise<RedditThread[]> {
    const json = await this.get<{
      data?: { children?: Array<{ data: Record<string, unknown> }> };
    }>(`/r/${encodeURIComponent(subreddit)}/search`, {
      q: query,
      restrict_sr: '1',
      sort: 'new',
      t: options?.time ?? 'day',
      limit: String(options?.limit ?? 100),
    });
    return (json.data?.children ?? []).map((child) => mapThread(child.data));
  }

  // GET /r/{sub}/hot — top posts for community analysis
  async getHotThreads(subreddit: string, limit = 25): Promise<RedditThread[]> {
    const json = await this.get<{
      data?: { children?: Array<{ data: Record<string, unknown> }> };
    }>(`/r/${encodeURIComponent(subreddit)}/hot`, { limit: String(limit) });
    return (json.data?.children ?? []).map((child) => mapThread(child.data));
  }

  // GET /api/info?id=t3_x,t3_y — engagement check after the user posted
  async getThreadsByFullname(fullnames: string[]): Promise<RedditThread[]> {
    if (fullnames.length === 0) return [];
    const json = await this.get<{
      data?: { children?: Array<{ data: Record<string, unknown> }> };
    }>('/api/info', { id: fullnames.join(',') });
    return (json.data?.children ?? []).map((child) => mapThread(child.data));
  }
}

/** Drops a cached token — call after credentials for that app change. */
export function forgetRedditToken(clientId: string): void {
  tokenCache.delete(clientId);
}

function mapSubreddit(data: Record<string, unknown>): RedditSubreddit {
  return {
    display_name: str(data.display_name),
    title: str(data.title),
    url: `https://www.reddit.com${str(data.url) || `/r/${str(data.display_name)}/`}`,
    subscribers: num(data.subscribers),
    active_user_count: typeof data.active_user_count === 'number' ? data.active_user_count : null,
    public_description: str(data.public_description),
    over18: data.over18 === true,
    lang: typeof data.lang === 'string' ? data.lang : null,
  };
}

function mapThread(data: Record<string, unknown>): RedditThread {
  const id = str(data.id);
  return {
    id,
    fullname: str(data.name) || `t3_${id}`,
    title: str(data.title),
    selftext: str(data.selftext),
    author: str(data.author),
    subreddit: str(data.subreddit),
    permalink: `https://www.reddit.com${str(data.permalink)}`,
    created_utc: num(data.created_utc),
    score: num(data.score),
    num_comments: num(data.num_comments),
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
