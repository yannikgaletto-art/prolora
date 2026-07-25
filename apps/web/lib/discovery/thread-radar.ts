import { getServiceDb, type DiscoveryCommunityRow, type WorkspaceContextRow } from '@/lib/db';
import type { DiscoveredThread } from '@/lib/integrations/registry';
import { getDiscoveryProvider, toDiscoveryProvider } from './providers';
import { checkCooldown } from './cooldown-tracker';
import { evaluateThreads, type EvaluationUsage } from '@/lib/ai/evaluate-threads';

const RELEVANCE_THRESHOLD = 0.6;
const MAX_CANDIDATES_PER_SCAN = 30;

export interface RadarScanResult {
  scanned: number;
  keywordMatches: number;
  evaluated: number;
  opportunitiesCreated: number;
  usage: EvaluationUsage;
}

const EMPTY_USAGE: EvaluationUsage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };

/**
 * The provider-native id, with a pre-015 fallback derived from the display name.
 * Rows written before migration 015 have no `community_external_id`, and a scan
 * must not skip them just because the column is not backfilled yet.
 */
export function communityExternalId(community: DiscoveryCommunityRow): string {
  if (community.community_external_id) return community.community_external_id;
  const name = community.community_name;
  const quoted = name.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return name.replace(/^r\//i, '').replace(/^#/, '');
}

// Two-stage filter (Blind Spot D1):
//   Stage 1 — keyword match (free, <1ms/thread): the provider's own search plus
//             a local keyword re-check kills ~80% of noise before any LLM sees it.
//   Stage 2 — LLM batch evaluation (10 threads/call) only for the survivors.
// Cost: ~$0.001/batch instead of $0.01/thread -> factor ~960 cheaper.
//
// Provider-agnostic since the multi-platform rollout: `community.platform`
// decides which DiscoveryProvider answers, and `scanThreads: false` providers
// are skipped instead of being asked something they cannot do.
export async function scanCommunity(
  community: DiscoveryCommunityRow,
  context: WorkspaceContextRow
): Promise<RadarScanResult> {
  const db = getServiceDb();

  const providerId = toDiscoveryProvider(community.platform);
  if (!providerId) {
    console.error(
      `[thread-radar] community ${community.id} has unknown platform "${community.platform}" — skipping`
    );
    return { scanned: 0, keywordMatches: 0, evaluated: 0, opportunitiesCreated: 0, usage: EMPTY_USAGE };
  }

  const provider = await getDiscoveryProvider(community.workspace_id, providerId);
  if (!provider.capabilities.scanThreads) {
    return { scanned: 0, keywordMatches: 0, evaluated: 0, opportunitiesCreated: 0, usage: EMPTY_USAGE };
  }

  const keywords = (community.keywords.length > 0 ? community.keywords : context.suggested_keywords)
    .map((k) => k.toLowerCase())
    .filter(Boolean);

  if (keywords.length === 0) {
    return { scanned: 0, keywordMatches: 0, evaluated: 0, opportunitiesCreated: 0, usage: EMPTY_USAGE };
  }

  const externalId = communityExternalId(community);

  // Stage 1a: the provider does the heavy keyword lifting server-side where it
  // can (Reddit, HN); the fan-out providers filter locally against the same
  // OR-joined query.
  const query = keywords.slice(0, 6).join(' OR ');
  const threads = await provider.searchThreads(externalId, query, { time: 'day', limit: 100 });
  for (const degradation of provider.degradations ?? []) {
    console.error(
      `[thread-radar] ${providerId} partial result — ${degradation.source}: ${degradation.reason}`
    );
  }

  // Stage 1b: local re-check — provider search is fuzzy, this is exact.
  const keywordMatched = threads.filter((thread) => {
    const haystack = `${thread.title} ${thread.body}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  // Dedup: UNIQUE(workspace_id, platform, thread_external_id) backs this,
  // but filtering up-front saves LLM spend on already-known threads.
  const fresh = await filterAlreadyKnown(community.workspace_id, community.platform, keywordMatched);
  const candidates = fresh.slice(0, MAX_CANDIDATES_PER_SCAN);

  if (candidates.length === 0) {
    await touchLastScanned(community.id);
    return {
      scanned: threads.length,
      keywordMatches: keywordMatched.length,
      evaluated: 0,
      opportunitiesCreated: 0,
      usage: EMPTY_USAGE,
    };
  }

  // Stage 2: batched LLM evaluation.
  const { evaluations, usage } = await evaluateThreads(
    candidates.map((thread) => ({
      title: thread.title,
      body: thread.body,
      community: thread.communityName,
    })),
    context.product_description ?? '',
    context.target_audience ?? ''
  );

  // Cooldown state applies to every opportunity from this community equally.
  const cooldown = await checkCooldown(community.workspace_id, community.community_name);

  let created = 0;
  for (const evaluation of evaluations) {
    if (!evaluation.relevant || evaluation.relevance_score <= RELEVANCE_THRESHOLD) continue;
    const thread = candidates[evaluation.thread_index];
    if (!thread) continue;

    const { error } = await db.from('opportunity_threads').insert({
      workspace_id: community.workspace_id,
      community_id: community.id,
      platform: community.platform,
      community_name: community.community_name,
      thread_title: thread.title,
      thread_url: thread.url,
      thread_external_id: thread.externalId,
      thread_author: thread.author,
      thread_body: thread.body.slice(0, 10000),
      posted_at: thread.createdAt > 0 ? new Date(thread.createdAt * 1000).toISOString() : null,
      relevance_score: evaluation.relevance_score,
      intent_type: evaluation.intent_type,
      intent_score: evaluation.intent_score,
      suggested_angle: evaluation.suggested_angle,
      status: 'new',
      cooldown_warning: cooldown.warning,
      engagement_upvotes: thread.score,
      engagement_replies: thread.replies,
    });

    if (error) {
      // 23505 = unique violation: another scan already saved it. Fine.
      if (!error.message.includes('duplicate key')) {
        console.error('[thread-radar] opportunity insert failed:', error.message);
      }
      continue;
    }
    created++;
  }

  await touchLastScanned(community.id);

  return {
    scanned: threads.length,
    keywordMatches: keywordMatched.length,
    evaluated: candidates.length,
    opportunitiesCreated: created,
    usage,
  };
}

async function filterAlreadyKnown(
  workspaceId: string,
  platform: string,
  threads: DiscoveredThread[]
): Promise<DiscoveredThread[]> {
  if (threads.length === 0) return [];
  const db = getServiceDb();
  const { data, error } = await db
    .from('opportunity_threads')
    .select('thread_external_id')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .in(
      'thread_external_id',
      threads.map((t) => t.externalId)
    )
    .returns<Array<{ thread_external_id: string }>>();
  if (error) {
    console.error('[thread-radar] dedup query failed:', error.message);
    return threads; // fall back to the DB unique constraint
  }
  const known = new Set((data ?? []).map((row) => row.thread_external_id));
  return threads.filter((thread) => !known.has(thread.externalId));
}

async function touchLastScanned(communityId: string): Promise<void> {
  const db = getServiceDb();
  const { error } = await db
    .from('discovery_communities')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('id', communityId);
  if (error) {
    console.error('[thread-radar] last_scanned_at update failed:', error.message);
  }
}
