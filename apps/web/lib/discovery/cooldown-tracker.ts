import type { CooldownCheck } from '@prolora/shared';
import { getServiceDb, type DiscoveryCommunityRow } from '@/lib/db';

const DEFAULT_WEEKLY_LIMIT = 2;

// Anti-spam guard (Blind Spot D4): max 2 posts per community per week.
// The warning never blocks anything — the human decides (AI assists).
export async function checkCooldown(
  workspaceId: string,
  communityName: string
): Promise<CooldownCheck> {
  const db = getServiceDb();

  const { data: community, error } = await db
    .from('discovery_communities')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('community_name', communityName)
    .maybeSingle<DiscoveryCommunityRow>();
  if (error) {
    throw new Error(`[cooldown] community lookup failed: ${error.message}`);
  }

  if (!community) {
    return {
      community_name: communityName,
      posts_this_week: 0,
      last_posted_at: null,
      recommended_wait_days: 0,
      warning: null,
    };
  }

  const { data: lastPosted, error: lastError } = await db
    .from('opportunity_threads')
    .select('posted_at_confirmed')
    .eq('workspace_id', workspaceId)
    .eq('community_name', communityName)
    .eq('status', 'posted')
    .order('posted_at_confirmed', { ascending: false })
    .limit(1)
    .returns<Array<{ posted_at_confirmed: string | null }>>();
  if (lastError) {
    console.error('[cooldown] last-posted lookup failed:', lastError.message);
  }

  const postsThisWeek = community.posts_this_week ?? 0;
  const cooldownDays = community.posting_cooldown_days ?? 5;
  const overLimit = postsThisWeek >= DEFAULT_WEEKLY_LIMIT;

  return {
    community_name: communityName,
    posts_this_week: postsThisWeek,
    last_posted_at: lastPosted?.[0]?.posted_at_confirmed ?? null,
    recommended_wait_days: overLimit ? cooldownDays : 0,
    warning: overLimit
      ? `Du hast diese Woche schon ${postsThisWeek}x in ${communityName} gepostet. Empfehlung: ${cooldownDays} Tage warten.`
      : null,
  };
}

// Called from confirm-posted: bumps the weekly counter.
// (Soft counter — a rare lost increment is acceptable; the weekly reset
// cron zeroes it every Sunday.)
export async function recordPost(workspaceId: string, communityName: string): Promise<void> {
  const db = getServiceDb();
  const { data: community, error } = await db
    .from('discovery_communities')
    .select('id, posts_this_week')
    .eq('workspace_id', workspaceId)
    .eq('community_name', communityName)
    .maybeSingle<{ id: string; posts_this_week: number }>();
  if (error || !community) {
    if (error) console.error('[cooldown] recordPost lookup failed:', error.message);
    return;
  }

  const { error: updateError } = await db
    .from('discovery_communities')
    .update({ posts_this_week: (community.posts_this_week ?? 0) + 1 })
    .eq('id', community.id);
  if (updateError) {
    console.error('[cooldown] counter update failed:', updateError.message);
  }
}
