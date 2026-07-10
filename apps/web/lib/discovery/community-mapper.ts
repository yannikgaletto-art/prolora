import type { DiscoveredCommunity } from '@prolora/shared';
import { CREDIT_COSTS } from '@prolora/shared';
import { getServiceDb } from '@/lib/db';
import { getRedditClient, type RedditSubreddit } from './reddit-client';
import { getWorkspaceContext } from './auto-context';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';

const MAX_CANDIDATES = 15;
const MIN_SUBSCRIBERS = 1000;
const RELEVANCE_THRESHOLD = 0.5;

export interface CommunityMapperInput {
  workspaceId: string;
  productDescription: string;
  targetAudience: string;
  competitors?: string[];
}

// ICP -> relevant subreddits: Reddit discovery + rules, then ONE batched
// LLM evaluation call for all candidates (cost discipline, Blind Spot D1).
export async function mapCommunities(input: CommunityMapperInput): Promise<DiscoveredCommunity[]> {
  const reddit = getRedditClient();

  const topics = await deriveSearchTopics(input);

  // Discovery sweep across topics, deduped by subreddit name.
  const bySubreddit = new Map<string, RedditSubreddit>();
  for (const topic of topics.slice(0, 4)) {
    try {
      const results = await reddit.searchSubreddits(topic, 25);
      for (const sub of results) {
        if (sub.over18 || sub.subscribers < MIN_SUBSCRIBERS) continue;
        if (!bySubreddit.has(sub.display_name.toLowerCase())) {
          bySubreddit.set(sub.display_name.toLowerCase(), sub);
        }
      }
    } catch (error) {
      console.error(`[community-mapper] search for "${topic}" failed:`, error);
    }
  }

  const candidates = [...bySubreddit.values()]
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) {
    return [];
  }

  // Rules + top posts per candidate (both feed the LLM evaluation).
  const enriched = await Promise.all(
    candidates.map(async (sub) => {
      let rulesText = '';
      let hotTitles: string[] = [];
      try {
        const rules = await reddit.getSubredditRules(sub.display_name);
        rulesText = rules.map((r) => `${r.short_name}: ${r.description}`.slice(0, 300)).join('\n');
      } catch {
        rulesText = '(rules unavailable)';
      }
      try {
        const hot = await reddit.getHotThreads(sub.display_name, 10);
        hotTitles = hot.map((t) => t.title);
      } catch {
        hotTitles = [];
      }
      return { sub, rulesText, hotTitles };
    })
  );

  const evaluations = await evaluateCommunities(enriched, input);

  // Persist relevant communities + build the response.
  const db = getServiceDb();
  const discovered: DiscoveredCommunity[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.relevance_score < RELEVANCE_THRESHOLD) continue;
    const entry = enriched[evaluation.index];
    if (!entry) continue;

    const community: DiscoveredCommunity = {
      platform: 'reddit',
      name: `r/${entry.sub.display_name}`,
      url: entry.sub.url,
      member_count: entry.sub.subscribers,
      activity_level: activityLevel(entry.sub),
      relevance_score: evaluation.relevance_score,
      language: evaluation.language,
      rules_summary: evaluation.rules_summary,
      self_promo_policy: evaluation.self_promo_policy,
      recommended_approach: evaluation.recommended_approach,
      top_recurring_questions: evaluation.top_recurring_questions,
    };
    discovered.push(community);

    // Upsert by (workspace, platform, community_name) — no DB constraint,
    // so check-then-write.
    const { data: existing, error: lookupError } = await db
      .from('discovery_communities')
      .select('id')
      .eq('workspace_id', input.workspaceId)
      .eq('platform', 'reddit')
      .eq('community_name', community.name)
      .maybeSingle<{ id: string }>();
    if (lookupError) {
      console.error('[community-mapper] lookup failed:', lookupError.message);
      continue;
    }

    const payload = {
      workspace_id: input.workspaceId,
      platform: 'reddit',
      community_name: community.name,
      community_url: community.url,
      member_count: community.member_count,
      activity_level: community.activity_level,
      relevance_score: community.relevance_score,
      language: community.language,
      rules_summary: community.rules_summary,
      self_promo_policy: community.self_promo_policy,
      recommended_approach: community.recommended_approach,
      top_questions: community.top_recurring_questions,
      keywords: topics,
      is_active: true,
    };

    const { error: writeError } = existing
      ? await db.from('discovery_communities').update(payload).eq('id', existing.id)
      : await db.from('discovery_communities').insert(payload);
    if (writeError) {
      console.error('[community-mapper] write failed:', writeError.message);
    }
  }

  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: input.workspaceId,
    action: 'community_discovery',
    credits_used: CREDIT_COSTS.community_discovery,
    metadata: { candidates: candidates.length, discovered: discovered.length, topics },
  });
  if (usageError) {
    console.error('[community-mapper] usage log failed:', usageError.message);
  }

  return discovered.sort((a, b) => b.relevance_score - a.relevance_score);
}

// Prefer stored auto-context keywords; otherwise derive topics via one
// small tool-use call.
async function deriveSearchTopics(input: CommunityMapperInput): Promise<string[]> {
  const context = await getWorkspaceContext(input.workspaceId);
  if (context && context.suggested_keywords.length >= 3) {
    return context.suggested_keywords;
  }

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content:
          `Product: ${input.productDescription}\nAudience: ${input.targetAudience}` +
          `${input.competitors?.length ? `\nCompetitors: ${input.competitors.join(', ')}` : ''}\n\n` +
          'Give 4-6 short search topics to find relevant communities (subreddits) for this product.',
      },
    ],
    tools: [
      {
        name: 'search_topics',
        description: 'Return the search topics',
        input_schema: {
          type: 'object' as const,
          properties: { topics: { type: 'array', items: { type: 'string' } } },
          required: ['topics'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'search_topics' },
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  const topics =
    block && block.type === 'tool_use'
      ? ((block.input as { topics?: unknown }).topics ?? [])
      : [];
  const cleaned = Array.isArray(topics)
    ? topics.filter((t): t is string => typeof t === 'string').slice(0, 6)
    : [];
  return cleaned.length > 0 ? cleaned : [input.productDescription.slice(0, 60)];
}

interface CommunityEvaluation {
  index: number;
  relevance_score: number;
  language: string;
  rules_summary: string;
  self_promo_policy: 'strict' | 'moderate' | 'allowed';
  recommended_approach: string;
  top_recurring_questions: string[];
}

async function evaluateCommunities(
  enriched: Array<{ sub: RedditSubreddit; rulesText: string; hotTitles: string[] }>,
  input: CommunityMapperInput
): Promise<CommunityEvaluation[]> {
  const client = getAnthropicClient();

  const communityList = enriched
    .map(
      ({ sub, rulesText, hotTitles }, index) =>
        `[${index}] r/${sub.display_name} (${sub.subscribers} members)\n` +
        `Description: ${sub.public_description.slice(0, 300)}\n` +
        `Rules:\n${rulesText.slice(0, 800)}\n` +
        `Recent hot posts: ${hotTitles.slice(0, 10).join(' | ').slice(0, 600)}`
    )
    .join('\n\n---\n\n');

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system:
      'You evaluate communities for organic (non-spammy) participation by a product team. ' +
      'self_promo_policy: read the rules — "strict" (bans promotion), "moderate" (allowed with limits), "allowed". ' +
      'recommended_approach: 1-2 sentences on HOW to add value there. Be honest about low relevance.',
    messages: [
      {
        role: 'user',
        content:
          `Product: ${input.productDescription}\nTarget audience: ${input.targetAudience}\n\n` +
          `Evaluate these ${enriched.length} communities:\n\n${communityList}`,
      },
    ],
    tools: [
      {
        name: 'community_evaluation',
        description: 'Return one evaluation per community',
        input_schema: {
          type: 'object' as const,
          properties: {
            evaluations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  relevance_score: { type: 'number', description: '0.0-1.0' },
                  language: { type: 'string', description: 'dominant language, ISO 639-1' },
                  rules_summary: { type: 'string', description: '2-3 sentence summary of the rules' },
                  self_promo_policy: { type: 'string', enum: ['strict', 'moderate', 'allowed'] },
                  recommended_approach: { type: 'string' },
                  top_recurring_questions: { type: 'array', items: { type: 'string' } },
                },
                required: [
                  'index',
                  'relevance_score',
                  'language',
                  'rules_summary',
                  'self_promo_policy',
                  'recommended_approach',
                  'top_recurring_questions',
                ],
              },
            },
          },
          required: ['evaluations'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'community_evaluation' },
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return [];
  const raw = (block.input as { evaluations?: unknown }).evaluations;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): CommunityEvaluation[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const index = typeof record.index === 'number' ? record.index : -1;
    if (index < 0 || index >= enriched.length) return [];
    const policy =
      typeof record.self_promo_policy === 'string' &&
      ['strict', 'moderate', 'allowed'].includes(record.self_promo_policy)
        ? (record.self_promo_policy as 'strict' | 'moderate' | 'allowed')
        : 'strict';
    return [
      {
        index,
        relevance_score: Math.max(
          0,
          Math.min(1, typeof record.relevance_score === 'number' ? record.relevance_score : 0)
        ),
        language: typeof record.language === 'string' ? record.language.slice(0, 8) : 'en',
        rules_summary: typeof record.rules_summary === 'string' ? record.rules_summary : '',
        self_promo_policy: policy,
        recommended_approach:
          typeof record.recommended_approach === 'string' ? record.recommended_approach : '',
        top_recurring_questions: Array.isArray(record.top_recurring_questions)
          ? record.top_recurring_questions
              .filter((q): q is string => typeof q === 'string')
              .slice(0, 5)
          : [],
      },
    ];
  });
}

function activityLevel(sub: RedditSubreddit): 'high' | 'medium' | 'low' {
  const active = sub.active_user_count ?? 0;
  if (active > 1000 || sub.subscribers > 500_000) return 'high';
  if (active > 100 || sub.subscribers > 50_000) return 'medium';
  return 'low';
}
