// Reddit API wrapper — Application-Only auth (client_credentials).
// Prolora reads Reddit with its OWN app key. It NEVER acts as the user and
// NEVER creates posts or comments (Invarianten D1/D2).

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';
const USER_AGENT = 'web:prolora:v1.0 (DACH feedback & publishing SaaS)';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

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
  // Token lives 24h — cache and refresh 5 minutes early.
  private async getToken(): Promise<string> {
    if (cachedToken && cachedToken.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cachedToken.accessToken;
    }

    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not configured');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    if (!response.ok) {
      throw new Error(`Reddit token request failed: HTTP ${response.status}`);
    }
    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error('Reddit token response missing access_token');
    }
    cachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 86400) * 1000,
    };
    return cachedToken.accessToken;
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

let sharedClient: RedditClient | null = null;

export function getRedditClient(): RedditClient {
  if (!sharedClient) sharedClient = new RedditClient();
  return sharedClient;
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
