import { ProloraApiError } from './errors.js';
import type {
  AddResponseMapEntryResponse,
  AdaptContentResponse,
  AskFeedbackResponse,
  AutoContextResponse,
  ConfirmPostedResponse,
  CreatePostResponse,
  DeletePostResponse,
  DiscoverCommunitiesResponse,
  DraftReplyResponse,
  FeedbackSummaryResponse,
  GetResponseMapResponse,
  GetVoiceConfigResponse,
  ListConnectionsResponse,
  ListFeedbackResponse,
  ListOpportunitiesResponse,
  ListPostsResponse,
  MarkFeedbackResponse,
  PostGroup,
  ResponseMapEntry,
  RetryPostResponse,
  ReuseContentResponse,
  VoiceTone,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.prolora.eu/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 60_000;

// The API key is read once at construction, kept only in this closure, and
// used exclusively as the x-prolora-key request header. It is NEVER logged
// and NEVER echoed back in any tool response.
export class ProloraClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    const apiKey = process.env.PROLORA_API_KEY;
    if (!apiKey) {
      throw new Error(
        'PROLORA_API_KEY ist nicht gesetzt. Hole deinen API-Key unter prolora.eu/settings und setze ihn als Umgebungsvariable.'
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = (process.env.PROLORA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: { query?: Record<string, string | number | boolean | undefined>; body?: unknown; llm?: boolean } = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.llm ? LLM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'x-prolora-key': this.apiKey,
          ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      const message = await extractErrorMessage(response);
      throw new ProloraApiError(
        response.status,
        message,
        response.status === 429 || response.status >= 500,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // --- Publishing ---

  createPost(input: {
    content: string;
    platforms: string[];
    scheduled_at?: string;
    adapt_content?: boolean;
    first_comment?: string;
  }): Promise<CreatePostResponse> {
    return this.request('POST', '/posts', { body: input });
  }

  getPost(postGroupId: string): Promise<PostGroup> {
    return this.request('GET', `/posts/${encodeURIComponent(postGroupId)}`);
  }

  listPosts(params: { status?: string; limit?: number; offset?: number }): Promise<ListPostsResponse> {
    const perPage = params.limit ?? 20;
    const page = params.offset ? Math.floor(params.offset / perPage) + 1 : 1;
    return this.request('GET', '/posts', { query: { status: params.status, per_page: perPage, page } });
  }

  deletePost(postGroupId: string): Promise<DeletePostResponse> {
    return this.request('DELETE', `/posts/${encodeURIComponent(postGroupId)}`);
  }

  retryPost(postGroupId: string): Promise<RetryPostResponse> {
    return this.request('POST', `/posts/${encodeURIComponent(postGroupId)}/retry`);
  }

  adaptContent(input: { content: string; platforms: string[] }): Promise<AdaptContentResponse> {
    return this.request('POST', '/content/adapt', { body: input, llm: true });
  }

  listConnections(): Promise<ListConnectionsResponse> {
    return this.request('GET', '/connections');
  }

  // --- Listening ---

  getFeedback(params: {
    sentiment?: string;
    source?: string;
    since?: string;
    urgency?: string;
    limit?: number;
    page?: number;
  }): Promise<ListFeedbackResponse> {
    return this.request('GET', '/feedback', {
      query: {
        sentiment: params.sentiment,
        platform: params.source,
        date_from: params.since,
        urgency: params.urgency,
        per_page: params.limit ?? 20,
        page: params.page,
      },
    });
  }

  getFeedbackSummary(params: { period?: '7d' | '30d' | '90d'; includeAiSummary?: boolean }): Promise<FeedbackSummaryResponse> {
    return this.request('GET', '/feedback/summary', {
      query: { period: params.period ?? '30d', include_ai_summary: params.includeAiSummary ?? true },
      llm: params.includeAiSummary ?? true,
    });
  }

  askFeedback(question: string): Promise<AskFeedbackResponse> {
    return this.request('POST', '/feedback/ask', { body: { question }, llm: true });
  }

  markFeedback(feedbackId: string, status: 'reviewed' | 'actioned' | 'archived'): Promise<MarkFeedbackResponse> {
    return this.request('PATCH', `/feedback/${encodeURIComponent(feedbackId)}/status`, { body: { status } });
  }

  // --- Discovery ---

  async discoverCommunities(input: {
    website_url?: string;
    product_description?: string;
    target_audience?: string;
  }): Promise<DiscoverCommunitiesResponse> {
    let productDescription = input.product_description;
    let targetAudience = input.target_audience;

    // No description/audience given but a URL was: derive them first via
    // auto-context, then feed the result into the community mapper — the
    // "combines two sequential calls" case S2 anticipates.
    if ((!productDescription || !targetAudience) && input.website_url) {
      const context = await this.autoContext(input.website_url);
      productDescription ??= context.product_description;
      targetAudience ??= context.target_audience;
    }

    if (!productDescription || !targetAudience) {
      throw new ProloraApiError(
        400,
        'Gib entweder website_url an (für Auto-Context) oder product_description + target_audience direkt.',
        false
      );
    }

    return this.request('POST', '/discover/communities', {
      body: { product_description: productDescription, target_audience: targetAudience },
      llm: true,
    });
  }

  autoContext(websiteUrl: string): Promise<AutoContextResponse> {
    return this.request('POST', '/discover/auto-context', { body: { website_url: websiteUrl }, llm: true });
  }

  getOpportunities(params: {
    min_relevance?: number;
    status?: string;
    limit?: number;
  }): Promise<ListOpportunitiesResponse> {
    return this.request<ListOpportunitiesResponse>('GET', '/discover/opportunities', {
      query: { status: params.status, per_page: params.limit ?? 10 },
    }).then((res) => {
      // min_relevance has no server-side filter — applied client-side; the
      // API already sorts by relevance_score desc so this only trims the tail.
      if (params.min_relevance === undefined) return res;
      const filtered = res.opportunities.filter(
        (o) => (o.relevance_score ?? 0) >= params.min_relevance!
      );
      return { ...res, opportunities: filtered, total: filtered.length };
    });
  }

  draftReply(input: { opportunity_id: string; tone?: VoiceTone }): Promise<DraftReplyResponse> {
    return this.request('POST', '/discover/draft', {
      body: { opportunity_id: input.opportunity_id, ...(input.tone ? { voice_config: { tone: input.tone } } : {}) },
      llm: true,
    });
  }

  confirmPosted(opportunityId: string, postedUrl?: string): Promise<ConfirmPostedResponse> {
    return this.request('POST', `/discover/${encodeURIComponent(opportunityId)}/confirm`, {
      body: postedUrl ? { posted_url: postedUrl } : {},
    });
  }

  reuseContent(input: {
    original_content: string;
    target_community: string;
    angle_shift: string;
    original_post_id?: string;
  }): Promise<ReuseContentResponse> {
    return this.request('POST', '/discover/reuse', { body: input, llm: true });
  }

  async getResponseMap(params: { category?: string; limit?: number }): Promise<GetResponseMapResponse> {
    // No server-side category/limit filter exists — the endpoint returns
    // every entry (best engagement first); both are applied client-side.
    const res = await this.request<GetResponseMapResponse>('GET', '/response-map');
    let entries: ResponseMapEntry[] = res.entries;
    if (params.category) {
      entries = entries.filter((e) => e.intent_type === params.category);
    }
    if (params.limit !== undefined) {
      entries = entries.slice(0, params.limit);
    }
    return { entries };
  }

  addResponseMapEntry(input: {
    question_pattern: string;
    best_answer: string;
    intent_type?: string;
    proof_asset_url?: string;
  }): Promise<AddResponseMapEntryResponse> {
    return this.request('POST', '/response-map', { body: input });
  }

  getVoiceConfig(): Promise<GetVoiceConfigResponse> {
    return this.request('GET', '/voice-config');
  }

  updateVoiceConfig(input: {
    tone?: VoiceTone;
    language?: string;
    max_reply_length?: number;
    include_personal_experience?: boolean;
    avoid_patterns?: string[];
    example_replies?: string[];
  }): Promise<GetVoiceConfigResponse> {
    return this.request('PATCH', '/voice-config', { body: input }).then((updated) =>
      // PATCH /voice-config returns { voice_config } already — pass through.
      updated as GetVoiceConfigResponse
    );
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    // body wasn't JSON — fall through to the generic message below.
  }
  return `Request failed with status ${response.status}.`;
}
