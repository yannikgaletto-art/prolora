import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { PlatformType, PostStatus } from '@prolora/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { findWorkspace } from '@/lib/workspace/workspace-lifecycle';
import { getPostGroups } from '@/lib/posts/list-posts';
import { PublishTabs } from '../PublishTabs';
import { PostsExplorer } from './PostsExplorer';

export const metadata: Metadata = { title: 'Posts — Prolora' };

const STATUS_VALUES: PostStatus[] = ['draft', 'queued', 'scheduled', 'publishing', 'published', 'failed', 'deleted'];
const PLATFORM_VALUES: PlatformType[] = ['linkedin', 'x', 'bluesky', 'mastodon', 'telegram', 'discord', 'devto', 'hashnode'];

const PER_PAGE = 20;

interface PublishPostsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Server Component (F0-4, Pfad A): reads posts through the lib/ service
// layer directly, never by fetch()-ing our own /api/v1/posts route.
export default async function PublishPostsPage({ searchParams }: PublishPostsPageProps) {
  const params = await searchParams;

  const supabase = await createSupabaseServerClient();
  const workspace = await findWorkspace(supabase);
  if (!workspace) redirect('/login');

  const statusRaw = firstValue(params.status);
  const status = STATUS_VALUES.includes(statusRaw as PostStatus) ? (statusRaw as PostStatus) : undefined;

  const platformRaw = firstValue(params.platform);
  const platform = PLATFORM_VALUES.includes(platformRaw as PlatformType)
    ? (platformRaw as PlatformType)
    : undefined;

  const pageRaw = firstValue(params.page);
  const page = pageRaw ? Math.max(1, Number.parseInt(pageRaw, 10) || 1) : 1;

  const { posts, perPage, total } = await getPostGroups(workspace.id, {
    status,
    platform,
    page,
    perPage: PER_PAGE,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Publish</h1>
        <p className="mt-1 text-sm text-gray-500">All posts created from this workspace.</p>
      </div>
      <PublishTabs active="posts" />
      <PostsExplorer
        posts={posts}
        page={page}
        perPage={perPage}
        total={total}
        status={status}
        platform={platform}
      />
    </div>
  );
}
