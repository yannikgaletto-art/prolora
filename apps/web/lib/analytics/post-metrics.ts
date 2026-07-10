import { getServiceDb, type PostGroupRow, type PostItemRow } from '@/lib/db';
import type { PlatformType, PostStatus } from '@prolora/shared';

// New lib file (F8 Analytics). Reuses the same post_groups + post_items
// join shape as lib/posts/list-posts.ts (F1 Publish) — no pagination here
// since this is a bonus, in-memory aggregation page over a single
// workspace's posts.

interface PostGroupWithItems extends Pick<PostGroupRow, 'id' | 'original_content'> {
  post_items: PostItemRow[];
}

export interface PlatformPostCount {
  platform: PlatformType;
  count: number;
  /** 0-100, share of totalPosts this platform accounts for. */
  percentage: number;
}

export interface PlatformEngagement {
  platform: PlatformType;
  likes: number;
  comments: number;
  impressions: number;
  /** (likes + comments) / impressions, 0 when impressions is 0. */
  rate: number;
}

export interface BestPost {
  postItemId: string;
  platform: PlatformType;
  platformUrl: string | null;
  content: string;
  publishedAt: string | null;
  likes: number;
  comments: number;
  impressions: number;
  engagementRate: number;
}

export interface PostAnalytics {
  totalPosts: number;
  publishedCount: number;
  failedCount: number;
  totalReach: number;
  postsPerPlatform: PlatformPostCount[];
  engagementPerPlatform: PlatformEngagement[];
  bestPost: BestPost | null;
}

function numericMetric(metrics: Record<string, unknown> | null, key: string): number {
  if (!metrics) return 0;
  const value = metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const PUBLISHED: PostStatus = 'published';
const FAILED: PostStatus = 'failed';

export async function getPostAnalytics(workspaceId: string): Promise<PostAnalytics> {
  const db = getServiceDb();

  const { data, error } = await db
    .from('post_groups')
    .select('id, original_content, post_items(*)')
    .eq('workspace_id', workspaceId)
    .returns<PostGroupWithItems[]>();

  if (error) {
    throw new Error(`[post-metrics] query failed: ${error.message}`);
  }

  const groups = data ?? [];
  const items: Array<{ item: PostItemRow; groupContent: string }> = [];
  for (const group of groups) {
    for (const item of group.post_items ?? []) {
      items.push({ item, groupContent: group.original_content });
    }
  }

  const totalPosts = items.length;
  const publishedCount = items.filter(({ item }) => item.status === PUBLISHED).length;
  const failedCount = items.filter(({ item }) => item.status === FAILED).length;

  let totalReach = 0;
  const perPlatformCounts = new Map<PlatformType, number>();
  const perPlatformEngagement = new Map<PlatformType, { likes: number; comments: number; impressions: number }>();

  let bestPost: BestPost | null = null;
  let bestRate = -1;

  for (const { item, groupContent } of items) {
    const metrics = (item.metrics ?? null) as Record<string, unknown> | null;
    const likes = numericMetric(metrics, 'likes');
    const comments = numericMetric(metrics, 'comments');
    const impressions = numericMetric(metrics, 'impressions');

    totalReach += impressions;

    perPlatformCounts.set(item.platform, (perPlatformCounts.get(item.platform) ?? 0) + 1);

    const engagement = perPlatformEngagement.get(item.platform) ?? { likes: 0, comments: 0, impressions: 0 };
    engagement.likes += likes;
    engagement.comments += comments;
    engagement.impressions += impressions;
    perPlatformEngagement.set(item.platform, engagement);

    if (impressions > 0) {
      const rate = (likes + comments) / impressions;
      if (rate > bestRate) {
        bestRate = rate;
        bestPost = {
          postItemId: item.id,
          platform: item.platform,
          platformUrl: item.platform_url,
          content: item.adapted_content ?? groupContent,
          publishedAt: item.published_at,
          likes,
          comments,
          impressions,
          engagementRate: rate,
        };
      }
    }
  }

  const postsPerPlatform: PlatformPostCount[] = Array.from(perPlatformCounts.entries())
    .map(([platform, count]) => ({
      platform,
      count,
      percentage: totalPosts > 0 ? (count / totalPosts) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const engagementPerPlatform: PlatformEngagement[] = Array.from(perPlatformEngagement.entries())
    .map(([platform, { likes, comments, impressions }]) => ({
      platform,
      likes,
      comments,
      impressions,
      rate: impressions > 0 ? (likes + comments) / impressions : 0,
    }))
    .sort((a, b) => b.rate - a.rate);

  return {
    totalPosts,
    publishedCount,
    failedCount,
    totalReach,
    postsPerPlatform,
    engagementPerPlatform,
    bestPost,
  };
}
