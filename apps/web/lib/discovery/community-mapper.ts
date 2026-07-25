// ICP -> relevant communities, across every discovery provider a workspace can
// reach. Speaks only against `DiscoveryProvider` (Vertrag C2) — no platform SDK
// is imported here, which is what makes a new platform a registry entry rather
// than an edit to this file.
//
// Two behaviours are deliberate and load-bearing:
//
//  * A provider without `readRules` answers `getCommunityRules` with `null`. That
//    is "rules not available", not a failure: the LLM evaluation drops the rules
//    section for that candidate and still scores relevance. Treating null as an
//    error would silently reduce discovery to Reddit again.
//  * `community_external_id` (migration 015) is the cross-provider dedupe key.
//    Until 015 is applied that column does not exist, so every read and write
//    that touches it degrades via `isMissingSchemaError` instead of 500-ing.

import type { DiscoveredCommunity } from '@prolora/shared';
import { CREDIT_COSTS } from '@prolora/shared';
import { getServiceDb, isMissingSchemaError } from '@/lib/db';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntegrationProvider } from '@/lib/integrations/types';
import {
  getProviderDescriptor,
  type CommunityRule,
  type DiscoveredCommunityCandidate,
  type DiscoveryProvider,
} from '@/lib/integrations/registry';
import {
  getDiscoveryProvider,
  listDiscoveryProviderStatuses,
} from './providers';
import { getWorkspaceContext } from './auto-context';
import { getAnthropicClient, AI_MODEL } from '@/lib/ai/client';
import { ApiError } from '@/lib/api/http';

const MAX_CANDIDATES = 15;
const CANDIDATES_PER_PROVIDER = 10;
const RELEVANCE_THRESHOLD = 0.5;

export interface CommunityMapperInput {
  workspaceId: string;
  productDescription: string;
  targetAudience: string;
  competitors?: string[];
  /** Restrict the sweep. Omitted = every provider this workspace can reach. */
  platforms?: IntegrationProvider[];
}

interface EnrichedCandidate {
  provider: IntegrationProvider;
  candidate: DiscoveredCommunityCandidate;
  /** `null` = the provider has no rules API (or could not be asked). */
  rules: CommunityRule[] | null;
  hotTitles: string[];
}

/**
 * Discovery is ready when at least one selected provider is reachable. Since
 * Mastodon and Hacker News need no credentials, a fresh workspace passes this —
 * the old "Reddit or nothing" gate was the reason a new workspace saw an empty
 * Discover page it could not act on.
 */
export async function assertDiscoveryConfiguration(
  workspaceId: string,
  platforms?: IntegrationProvider[]
): Promise<void> {
  const selected = await selectProviders(workspaceId, platforms);
  if (selected.length === 0) {
    throw new ApiError(
      503,
      platforms?.length
        ? 'None of the selected discovery platforms are connected for this workspace.'
        : 'No discovery platform is available. Connect one in Discover or Settings.',
      'discovery_not_configured'
    );
  }
}

async function selectProviders(
  workspaceId: string,
  platforms?: IntegrationProvider[]
): Promise<IntegrationProvider[]> {
  const statuses = await listDiscoveryProviderStatuses(workspaceId);
  const wanted = platforms?.length
    ? statuses.filter((status) => platforms.includes(status.provider))
    : statuses;
  return wanted.filter((status) => status.available).map((status) => status.provider);
}

export async function mapCommunities(input: CommunityMapperInput): Promise<DiscoveredCommunity[]> {
  await assertDiscoveryConfiguration(input.workspaceId, input.platforms);
  const providers = await selectProviders(input.workspaceId, input.platforms);

  const topics = await deriveSearchTopics(input);
  const searchTopics = topics.slice(0, 4);

  const enriched: EnrichedCandidate[] = [];
  for (const providerId of providers) {
    // One dead provider degrades the sweep; it never ends it.
    try {
      enriched.push(...(await sweepProvider(input.workspaceId, providerId, searchTopics)));
    } catch (error) {
      console.error(`[community-mapper] provider ${providerId} failed:`, error);
    }
  }

  const candidates = enriched
    .sort((a, b) => b.candidate.memberCount - a.candidate.memberCount)
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return [];

  const evaluations = await evaluateCommunities(candidates, input);

  const db = getServiceDb();
  const discovered: DiscoveredCommunity[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.relevance_score < RELEVANCE_THRESHOLD) continue;
    const entry = candidates[evaluation.index];
    if (!entry) continue;

    const community: DiscoveredCommunity = {
      platform: entry.provider,
      name: entry.candidate.name,
      url: entry.candidate.url,
      member_count: entry.candidate.memberCount,
      activity_level: activityLevel(entry.candidate),
      relevance_score: evaluation.relevance_score,
      language: evaluation.language,
      rules_summary: entry.rules === null ? 'Rules not available on this platform.' : evaluation.rules_summary,
      self_promo_policy: evaluation.self_promo_policy,
      recommended_approach: evaluation.recommended_approach,
      top_recurring_questions: evaluation.top_recurring_questions,
    };
    discovered.push(community);

    await persistCommunity(db, input.workspaceId, entry, community, topics);
  }

  const { error: usageError } = await db.from('usage_logs').insert({
    workspace_id: input.workspaceId,
    action: 'community_discovery',
    credits_used: CREDIT_COSTS.community_discovery,
    metadata: {
      candidates: candidates.length,
      discovered: discovered.length,
      topics,
      platforms: providers,
    },
  });
  if (usageError) {
    console.error('[community-mapper] usage log failed:', usageError.message);
  }

  return discovered.sort((a, b) => b.relevance_score - a.relevance_score);
}

async function sweepProvider(
  workspaceId: string,
  providerId: IntegrationProvider,
  topics: string[]
): Promise<EnrichedCandidate[]> {
  const descriptor = getProviderDescriptor(providerId);
  const provider = await getDiscoveryProvider(workspaceId, providerId);

  const found = await provider.searchCommunities(topics, CANDIDATES_PER_PROVIDER);
  logDegradations(providerId, provider);

  const usable = found.filter(
    (candidate) => !candidate.nsfw && candidate.memberCount >= descriptor.discoveryMinMembers
  );

  return Promise.all(
    usable.map(async (candidate) => ({
      provider: providerId,
      candidate,
      rules: await readRules(provider, candidate.externalId),
      hotTitles: await readHotTitles(provider, candidate.externalId),
    }))
  );
}

/** Never throws: `null` means "no rules to show", whatever the cause. */
async function readRules(
  provider: DiscoveryProvider,
  externalId: string
): Promise<CommunityRule[] | null> {
  if (!provider.capabilities.readRules) return null;
  try {
    return await provider.getCommunityRules(externalId);
  } catch (error) {
    console.error(`[community-mapper] rules for ${externalId} failed:`, error);
    return null;
  }
}

async function readHotTitles(
  provider: DiscoveryProvider,
  externalId: string
): Promise<string[]> {
  try {
    const hot = await provider.getHotThreads(externalId, 10);
    return hot.map((thread) => thread.title);
  } catch (error) {
    console.error(`[community-mapper] hot threads for ${externalId} failed:`, error);
    return [];
  }
}

function logDegradations(providerId: IntegrationProvider, provider: DiscoveryProvider): void {
  for (const degradation of provider.degradations ?? []) {
    console.error(
      `[community-mapper] ${providerId} partial result — ${degradation.source}: ${degradation.reason}`
    );
  }
}

/**
 * Upsert by (workspace, platform, external id). `community_external_id` arrives
 * with migration 015; without it the write falls back to the pre-015 shape
 * rather than failing, so a deploy that runs ahead of the migration still maps
 * communities (Deploy-Order-Guard).
 */
async function persistCommunity(
  db: SupabaseClient,
  workspaceId: string,
  entry: EnrichedCandidate,
  community: DiscoveredCommunity,
  topics: string[]
): Promise<void> {
  const externalId = entry.candidate.externalId;

  let existingId: string | null = null;
  const byExternal = await db
    .from('discovery_communities')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('platform', entry.provider)
    .eq('community_external_id', externalId)
    .maybeSingle<{ id: string }>();

  if (byExternal.error && !isMissingSchemaError(byExternal.error.code)) {
    console.error('[community-mapper] lookup failed:', byExternal.error.message);
    return;
  }
  if (byExternal.error) {
    // Pre-015 database: fall back to the name-based identity 014 used.
    const byName = await db
      .from('discovery_communities')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('platform', entry.provider)
      .eq('community_name', community.name)
      .maybeSingle<{ id: string }>();
    if (byName.error) {
      console.error('[community-mapper] lookup failed:', byName.error.message);
      return;
    }
    existingId = byName.data?.id ?? null;
  } else {
    existingId = byExternal.data?.id ?? null;
  }

  const base = {
    workspace_id: workspaceId,
    platform: entry.provider,
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

  const write = async (payload: Record<string, unknown>) =>
    existingId
      ? db.from('discovery_communities').update(payload).eq('id', existingId)
      : db.from('discovery_communities').insert(payload);

  const first = await write({ ...base, community_external_id: externalId });
  if (!first.error) return;

  if (isMissingSchemaError(first.error.code)) {
    const retry = await write(base);
    if (retry.error) {
      console.error('[community-mapper] write failed:', retry.error.message);
    }
    return;
  }
  console.error('[community-mapper] write failed:', first.error.message);
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
          'Give 4-6 short search topics to find relevant online communities for this product. ' +
          'They are used as subreddit searches, fediverse hashtags and Hacker News queries, so keep them single words or short phrases.',
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
  enriched: EnrichedCandidate[],
  input: CommunityMapperInput
): Promise<CommunityEvaluation[]> {
  const client = getAnthropicClient();

  const communityList = enriched.map((entry, index) => describeCandidate(entry, index)).join('\n\n---\n\n');

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    system:
      'You evaluate communities for organic (non-spammy) participation by a product team. ' +
      'self_promo_policy: read the rules — "strict" (bans promotion), "moderate" (allowed with limits), "allowed". ' +
      'When a community says "Rules: not published by this platform", do NOT guess a policy from the platform name — ' +
      'answer "strict" and say in recommended_approach that the rules must be checked manually. ' +
      'Some entries are saved topic searches rather than real communities; judge those on topic fit only. ' +
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

/** Exported for the prompt test: null rules must read as "not published". */
export function describeCandidate(entry: EnrichedCandidate, index: number): string {
  const { candidate, rules } = entry;
  const kind = candidate.isTopicQuery ? 'saved topic search' : 'community';
  const size = candidate.isTopicQuery
    ? `${candidate.memberCount} matching posts`
    : `${candidate.memberCount} members`;
  const rulesText =
    rules === null
      ? 'Rules: not published by this platform — evaluate on fit only.'
      : `Rules:\n${rules
          .map((rule) => `${rule.shortName}: ${rule.description}`.slice(0, 300))
          .join('\n')
          .slice(0, 800)}`;

  return (
    `[${index}] ${candidate.name} on ${entry.provider} (${kind}, ${size})\n` +
    `Description: ${candidate.description.slice(0, 300)}\n` +
    `${rulesText}\n` +
    `Recent hot posts: ${entry.hotTitles.slice(0, 10).join(' | ').slice(0, 600)}`
  );
}

function activityLevel(candidate: DiscoveredCommunityCandidate): 'high' | 'medium' | 'low' {
  const active = candidate.activeCount ?? 0;
  if (active > 1000 || candidate.memberCount > 500_000) return 'high';
  if (active > 100 || candidate.memberCount > 50_000) return 'medium';
  return 'low';
}
