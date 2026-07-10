import { getServiceDb, type DiscoveryCommunityRow, type WorkspaceContextRow } from '@/lib/db';
import { getRedditClient, type RedditThread } from './reddit-client';
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

// Two-stage filter (Blind Spot D1):
//   Stage 1 — keyword match (free, <1ms/thread): Reddit search + local
//             keyword re-check kills ~80% of noise before any LLM sees it.
//   Stage 2 — LLM batch evaluation (10 threads/call) only for the survivors.
// Cost: ~$0.001/batch instead of $0.01/thread -> factor ~960 cheaper.
export async function scanCommunity(
  community: DiscoveryCommunityRow,
  context: WorkspaceContextRow
): Promise<RadarScanResult> {
  const db = getServiceDb();
  const reddit = getRedditClient();

  const keywords = (community.keywords.length > 0 ? community.keywords : context.suggested_keywords)
    .map((k) => k.toLowerCase())
    .filter(Boolean);
  const emptyUsage: EvaluationUsage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };

  if (keywords.length === 0) {
    return { scanned: 0, keywordMatches: 0, evaluated: 0, opportunitiesCreated: 0, usage: emptyUsage };
  }

  const subreddit = community.community_name.replace(/^r\//, '');

  // Stage 1a: Reddit search does the heavy keyword lifting server-side.
  const query = keywords.slice(0, 6).join(' OR ');
  const threads = await reddit.searchThreads(subreddit, query, { time: 'day', limit: 100 });

  // Stage 1b: local re-check — the search API is fuzzy, this is exact.
  const keywordMatched = threads.filter((thread) => {
    const haystack = `${thread.title} ${thread.selftext}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

  // Dedup: UNIQUE(workspace_id, platform, thread_external_id) backs this,
  // but filtering up-front saves LLM spend on already-known threads.
  const fresh = await filterAlreadyKnown(community.workspace_id, keywordMatched);
  const candidates = fresh.slice(0, MAX_CANDIDATES_PER_SCAN);

  if (candidates.length === 0) {
    await touchLastScanned(community.id);
    return {
      scanned: threads.length,
      keywordMatches: keywordMatched.length,
      evaluated: 0,
      opportunitiesCreated: 0,
      usage: emptyUsage,
    };
  }

  // Stage 2: batched LLM evaluation.
  const { evaluations, usage } = await evaluateThreads(
    candidates.map((thread) => ({
      title: thread.title,
      body: thread.selftext,
      community: thread.subreddit,
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
      platform: 'reddit',
      community_name: community.community_name,
      thread_title: thread.title,
      thread_url: thread.permalink,
      thread_external_id: thread.fullname,
      thread_author: thread.author,
      thread_body: thread.selftext.slice(0, 10000),
      posted_at: new Date(thread.created_utc * 1000).toISOString(),
      relevance_score: evaluation.relevance_score,
      intent_type: evaluation.intent_type,
      intent_score: evaluation.intent_score,
      suggested_angle: evaluation.suggested_angle,
      status: 'new',
      cooldown_warning: cooldown.warning,
      engagement_upvotes: thread.score,
      engagement_replies: thread.num_comments,
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
  threads: RedditThread[]
): Promise<RedditThread[]> {
  if (threads.length === 0) return [];
  const db = getServiceDb();
  const { data, error } = await db
    .from('opportunity_threads')
    .select('thread_external_id')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'reddit')
    .in(
      'thread_external_id',
      threads.map((t) => t.fullname)
    )
    .returns<Array<{ thread_external_id: string }>>();
  if (error) {
    console.error('[thread-radar] dedup query failed:', error.message);
    return threads; // fall back to the DB unique constraint
  }
  const known = new Set((data ?? []).map((row) => row.thread_external_id));
  return threads.filter((thread) => !known.has(thread.fullname));
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
