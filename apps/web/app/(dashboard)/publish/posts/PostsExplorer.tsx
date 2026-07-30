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
import { Input } from '@/app/components/Input';
import { EmptyState } from '@/app/components/EmptyState';
import { Pagination } from '@/app/components/Pagination';
import { Toast, type ToastMessage } from '@/app/components/Toast';
import { fetchApi, errorMessage } from '@/app/lib/api';
import type { PostGroupWithItems } from '@/lib/posts/list-posts';
import type { MediaRef, PostItemRow } from '@/lib/db';
import { PLATFORM_META } from '../platform-meta';
import { storeAppliedTemplate } from '../handoff';
import {
  isLegacyReconciliationRequired,
  isLegacyRepublishPending,
} from '@/lib/posts/reconciliation-state';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'queued', label: 'Queued' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'published', label: 'Published' },
  { value: 'failed', label: 'Failed' },
  { value: 'reconciliation_required', label: 'Check platform' },
  { value: 'deleted', label: 'Deleted' },
];

const PLATFORM_OPTIONS = (Object.keys(PLATFORM_META) as PlatformType[]).map((platform) => ({
  value: platform,
  label: PLATFORM_META[platform].label,
}));

// Priority order for collapsing several post_items into one row status —
// worst-first, so a row with one failed item always reads as "Failed".
const STATUS_PRIORITY: PostStatus[] = [
  'reconciliation_required',
  'failed',
  'publishing',
  'scheduled',
  'queued',
  'draft',
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
  if (totals.shares) parts.push(`${numberFormatter.format(totals.shares)} shares`);
  if (totals.clicks) parts.push(`${numberFormatter.format(totals.clicks)} clicks`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Earliest actual publish time across the group's items, if any. */
function publishedAt(items: PostItemRow[]): string | null {
  const dates = items
    .map((item) => item.published_at)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates[0] ?? null;
}

const MEDIA_FALLBACK_ICON: Record<MediaRef['type'], string> = {
  image: '🖼',
  video: '🎬',
  document: '📄',
};

function MediaThumb({
  media,
  previewUrl,
  size,
}: {
  media: MediaRef;
  previewUrl: string | null;
  size: 'sm' | 'lg';
}) {
  const alt = media.alt_text ?? `${media.type} attachment`;
  if (media.type === 'image' && previewUrl) {
    return size === 'sm' ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={previewUrl} alt={alt} className="h-8 w-8 rounded border border-white object-cover" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={previewUrl} alt={alt} className="max-h-48 rounded-md border border-gray-200 object-contain" />
    );
  }
  if (media.type === 'video' && previewUrl && size === 'lg') {
    return <video src={previewUrl} controls className="max-h-48 rounded-md" />;
  }
  return (
    <span
      title={alt}
      className={
        size === 'sm'
          ? 'flex h-8 w-8 items-center justify-center rounded border border-white bg-gray-100 text-xs'
          : 'flex h-20 w-20 items-center justify-center rounded-md border border-gray-200 bg-gray-100 text-2xl'
      }
    >
      {MEDIA_FALLBACK_ICON[media.type]}
    </span>
  );
}

export interface PostsExplorerProps {
  posts: PostGroupWithItems[];
  /** storage_key → short-lived signed URL (or null if unavailable). */
  mediaPreviews: Record<string, string | null>;
  page: number;
  perPage: number;
  total: number;
  status?: PostStatus;
  platform?: PlatformType;
}

export function PostsExplorer({ posts, mediaPreviews, page, perPage, total, status, platform }: PostsExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState<PostGroupWithItems | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [reconcilingItemId, setReconcilingItemId] = useState<string | null>(null);
  const [reconciliationDrafts, setReconciliationDrafts] = useState<
    Record<string, { platformPostId: string; platformUrl: string }>
  >({});

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

  async function handleConfirmedNotPublished(itemId: string) {
    setReconcilingItemId(itemId);
    try {
      await fetchApi(`/v1/posts/items/${itemId}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ resolution: 'not_published' }),
      });
      setToast({ variant: 'success', message: 'Fresh publish attempt queued.' });
      setSelected(null);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setReconcilingItemId(null);
    }
  }

  async function handleConfirmedPublished(itemId: string) {
    const draft = reconciliationDrafts[itemId] ?? { platformPostId: '', platformUrl: '' };
    const platformPostId = draft.platformPostId.trim();
    if (!platformPostId) {
      setToast({ variant: 'error', message: 'Enter the platform post ID.' });
      return;
    }
    setReconcilingItemId(itemId);
    try {
      await fetchApi(`/v1/posts/items/${itemId}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({
          resolution: 'published',
          platform_post_id: platformPostId,
          platform_url: draft.platformUrl.trim() || undefined,
        }),
      });
      setToast({ variant: 'success', message: 'Published post recorded.' });
      setSelected(null);
      router.refresh();
    } catch (error) {
      setToast({ variant: 'error', message: errorMessage(error) });
    } finally {
      setReconcilingItemId(null);
    }
  }

  // Archive → composer: the post lands as a normal editable draft (same
  // handoff the template wizard and Content Hub use). Media travels as
  // storage keys — ingestMedia re-attaches them without re-uploading.
  function handleReuse(post: PostGroupWithItems) {
    const media = (post.media ?? []).map((ref) => ({
      type: ref.type,
      url: ref.storage_key,
      mime_type: ref.mime_type,
      alt_text: ref.alt_text,
      preview_url: mediaPreviews[ref.storage_key] ?? undefined,
    }));
    storeAppliedTemplate(
      {
        content: post.original_content,
        firstComment: post.first_comment ?? undefined,
        connectionIds: [...new Set(post.post_items.map((item) => item.connection_id))],
        extras: null,
        media: media.length > 0 ? media : undefined,
      },
      Date.now()
    );
    router.push('/publish');
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
                {posts.map((post) => {
                  const published = publishedAt(post.post_items);
                  const media = post.media ?? [];
                  return (
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
                      <td className="max-w-xs px-4 py-3 text-gray-700">
                        <div className="flex items-center gap-2">
                          {media.length > 0 && (
                            <div className="flex shrink-0 -space-x-1">
                              {media.slice(0, 3).map((ref) => (
                                <MediaThumb
                                  key={ref.storage_key}
                                  media={ref}
                                  previewUrl={mediaPreviews[ref.storage_key] ?? null}
                                  size="sm"
                                />
                              ))}
                            </div>
                          )}
                          <span className="truncate">{preview(post.original_content)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={overallStatus(post.post_items)} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                        {published ? (
                          <span title="Published">{dateFormatter.format(new Date(published))}</span>
                        ) : (
                          <span title="Created">{dateFormatter.format(new Date(post.created_at))}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                        {formatMetrics(post.post_items)}
                      </td>
                    </tr>
                  );
                })}
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
            {selected && (
              <Button variant="secondary" disabled={retrying} onClick={() => handleReuse(selected)}>
                Reuse in composer
              </Button>
            )}
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
            {selected.first_comment && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">First comment</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{selected.first_comment}</p>
              </div>
            )}
            {(selected.media ?? []).length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Media</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {(selected.media ?? []).map((ref) => (
                    <div key={ref.storage_key} className="flex flex-col items-start gap-1">
                      <MediaThumb
                        media={ref}
                        previewUrl={mediaPreviews[ref.storage_key] ?? null}
                        size="lg"
                      />
                      <a
                        href={`/api/v1/media/download?key=${encodeURIComponent(ref.storage_key)}`}
                        download
                        className="text-xs font-medium text-gray-600 hover:underline"
                      >
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-gray-500">
              Created {dateFormatter.format(new Date(selected.created_at))}
              {selected.scheduled_at && ` · Scheduled for ${dateFormatter.format(new Date(selected.scheduled_at))}`}
            </p>
            <div className="flex flex-col gap-2">
              {selected.post_items.map((item) => (
                <div key={item.id} className="rounded-md border border-gray-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {PLATFORM_META[item.platform].label}
                    </span>
                    <Badge status={item.status} />
                  </div>
                  {item.published_at && (
                    <p className="mt-1 text-xs text-gray-500">
                      Published {dateFormatter.format(new Date(item.published_at))}
                    </p>
                  )}
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
                  {isLegacyRepublishPending(item) && (
                    <div className="mt-3 rounded-md bg-amber-50 p-3">
                      <p className="text-xs text-amber-900">
                        No platform post was found. Delivery of the replacement publish event was
                        interrupted, so it is safe to enqueue the confirmed attempt again.
                      </p>
                      <Button
                        variant="secondary"
                        className="mt-2"
                        loading={reconcilingItemId === item.id}
                        disabled={reconcilingItemId !== null && reconcilingItemId !== item.id}
                        onClick={() => handleConfirmedNotPublished(item.id)}
                      >
                        Retry confirmed no-post delivery
                      </Button>
                    </div>
                  )}
                  {!isLegacyRepublishPending(item) &&
                    (item.status === 'reconciliation_required' ||
                      isLegacyReconciliationRequired(item)) && (
                    <div className="mt-3 rounded-md bg-red-50 p-3">
                      <p className="text-xs text-red-800">
                        Check this account on the platform, then choose exactly one resolution.
                      </p>
                      <div className="mt-3 space-y-2">
                        <Input
                          label="Platform post ID"
                          value={reconciliationDrafts[item.id]?.platformPostId ?? ''}
                          onChange={(event) =>
                            setReconciliationDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                platformPostId: event.target.value,
                                platformUrl: current[item.id]?.platformUrl ?? '',
                              },
                            }))
                          }
                        />
                        <Input
                          label="Platform URL (optional)"
                          type="url"
                          value={reconciliationDrafts[item.id]?.platformUrl ?? ''}
                          onChange={(event) =>
                            setReconciliationDrafts((current) => ({
                              ...current,
                              [item.id]: {
                                platformPostId: current[item.id]?.platformPostId ?? '',
                                platformUrl: event.target.value,
                              },
                            }))
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            loading={reconcilingItemId === item.id}
                            disabled={reconcilingItemId !== null && reconcilingItemId !== item.id}
                            onClick={() => handleConfirmedPublished(item.id)}
                          >
                            Confirm post exists
                          </Button>
                          <Button
                            variant="secondary"
                            loading={reconcilingItemId === item.id}
                            disabled={reconcilingItemId !== null && reconcilingItemId !== item.id}
                            onClick={() => handleConfirmedNotPublished(item.id)}
                          >
                            Confirm no post exists and retry
                          </Button>
                        </div>
                      </div>
                    </div>
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
