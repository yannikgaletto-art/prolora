'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import type { PlatformType, PostStatus } from '@prolora/shared';
import { Badge } from '@/app/components/Badge';
import { Select } from '@/app/components/Select';
import { Card } from '@/app/components/Card';
import { Modal } from '@/app/components/Modal';
import { Button } from '@/app/components/Button';
import { EmptyState } from '@/app/components/EmptyState';
import { Pagination } from '@/app/components/Pagination';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { PostGroupWithItems } from '@/lib/posts/list-posts';
import type { PostItemRow } from '@/lib/db';
import { PLATFORM_META } from '../platform-meta';

const STATUS_OPTIONS = [
  { value: 'queued', label: 'Queued' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
  { value: 'deleted', label: 'Deleted' },
];

const PLATFORM_OPTIONS = (Object.keys(PLATFORM_META) as PlatformType[]).map((platform) => ({
  value: platform,
  label: PLATFORM_META[platform].label,
}));

// Priority order for collapsing several post_items into one row status —
// worst-first, so a row with one failed item always reads as "Failed".
const STATUS_PRIORITY: PostStatus[] = [
  'failed',
  'publishing',
  'scheduled',
  'queued',
  'published',
  'deleted',
];

function overallStatus(items: PostItemRow[]): PostStatus {
  for (const status of STATUS_PRIORITY) {
    if (items.some((item) => item.status === status)) return status;
  }
  return items[0]?.status ?? 'queued';
}

function preview(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function formatMetrics(items: PostItemRow[]): string {
  const totals: Record<string, number> = {};
  for (const item of items) {
    const metrics = item.metrics as Record<string, unknown> | null;
    if (!metrics) continue;
    for (const key of ['impressions', 'likes', 'comments', 'shares', 'clicks']) {
      const value = metrics[key];
      if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value;
    }
  }
  const numberFormatter = new Intl.NumberFormat('en-US');
  const parts: string[] = [];
  if (totals.impressions) parts.push(`${numberFormatter.format(totals.impressions)} views`);
  if (totals.likes) parts.push(`${numberFormatter.format(totals.likes)} likes`);
  if (totals.comments) parts.push(`${numberFormatter.format(totals.comments)} comments`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export interface PostsExplorerProps {
  posts: PostGroupWithItems[];
  page: number;
  perPage: number;
  total: number;
  status?: PostStatus;
  platform?: PlatformType;
}

export function PostsExplorer({ posts, page, perPage, total, status, platform }: PostsExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<PostGroupWithItems | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [retrying, setRetrying] = useState(false);

  function navigate(next: { status?: string; platform?: string; page?: number }) {
    const params = new URLSearchParams();
    const nextStatus = next.status !== undefined ? next.status : (status ?? '');
    const nextPlatform = next.platform !== undefined ? next.platform : (platform ?? '');
    if (nextStatus) params.set('status', nextStatus);
    if (nextPlatform) params.set('platform', nextPlatform);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  async function handleRetry(groupId: string) {
    setRetrying(true);
    try {
      await fetchApi(`/v1/posts/${groupId}/retry`, { method: 'POST' });
      setToast({ variant: 'success', message: 'Retry queued.' });
      setSelected(null);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setRetrying(false);
    }
  }

  const hasFailedItems = selected?.post_items.some((item) => item.status === 'failed') ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Select
          label="Status"
          className="w-44"
          options={STATUS_OPTIONS}
          placeholder="All statuses"
          value={status ?? ''}
          onChange={(event) => navigate({ status: event.target.value, page: 1 })}
        />
        <Select
          label="Platform"
          className="w-44"
          options={PLATFORM_OPTIONS}
          placeholder="All platforms"
          value={platform ?? ''}
          onChange={(event) => navigate({ platform: event.target.value, page: 1 })}
        />
      </div>

      {posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          description="Posts you publish or schedule from Prolora will show up here."
          action={
            <Link
              href="/publish"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              Compose a post
            </Link>
          }
        />
      ) : (
        <Card flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Platforms</th>
                  <th className="px-4 py-3">Content</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Metrics</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr
                    key={post.id}
                    onClick={() => setSelected(post)}
                    className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex -space-x-1.5">
                        {post.post_items.map((item) => (
                          <span
                            key={item.id}
                            title={`${PLATFORM_META[item.platform].label}: ${item.status}`}
                            aria-hidden="true"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white"
                            style={{ backgroundColor: PLATFORM_META[item.platform].color }}
                          >
                            {PLATFORM_META[item.platform].initial}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-gray-700">{preview(post.original_content)}</td>
                    <td className="px-4 py-3">
                      <Badge status={overallStatus(post.post_items)} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {dateFormatter.format(new Date(post.created_at))}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {formatMetrics(post.post_items)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            perPage={perPage}
            total={total}
            onPageChange={(nextPage) => navigate({ page: nextPage })}
          />
        </Card>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Post details"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSelected(null)} disabled={retrying}>
              Close
            </Button>
            {hasFailedItems && selected && (
              <Button variant="primary" loading={retrying} onClick={() => handleRetry(selected.id)}>
                Retry
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Content</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{selected.original_content}</p>
            </div>
            <div className="flex flex-col gap-2">
              {selected.post_items.map((item) => (
                <div key={item.id} className="rounded-md border border-gray-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {PLATFORM_META[item.platform].label}
                    </span>
                    <Badge status={item.status} />
                  </div>
                  {item.platform_url && (
                    <a
                      href={item.platform_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-sm text-primary-700 underline"
                    >
                      View on platform
                    </a>
                  )}
                  {item.error_message && (
                    <p className="mt-1 text-sm text-red-600">{item.error_message}</p>
                  )}
                  {formatMetrics([item]) !== '—' && (
                    <p className="mt-1 text-xs text-gray-500">{formatMetrics([item])}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
