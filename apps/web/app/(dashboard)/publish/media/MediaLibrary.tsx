'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/app/components/Card';
import { EmptyState } from '@/app/components/EmptyState';
import type { WorkspaceMediaItem } from '@/lib/media/library';
import { storeAppliedTemplate } from '../handoff';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

function downloadHref(storageKey: string): string {
  return `/api/v1/media/download?key=${encodeURIComponent(storageKey)}`;
}

export function MediaLibrary({
  media,
  previews,
}: {
  media: WorkspaceMediaItem[];
  previews: Record<string, string | null>;
}) {
  const router = useRouter();

  // Same handoff as templates/Content Hub/archive — the file lands as an
  // attached, editable draft in the composer; content stays untouched.
  function useInComposer(item: WorkspaceMediaItem) {
    storeAppliedTemplate(
      {
        content: '',
        connectionIds: [],
        extras: null,
        media: [
          {
            type: item.type,
            url: item.storage_key,
            mime_type: item.mime_type,
            preview_url: previews[item.storage_key] ?? undefined,
          },
        ],
      },
      Date.now()
    );
    router.push('/publish');
  }

  if (media.length === 0) {
    return (
      <EmptyState
        title="No media yet"
        description="Files you upload or generate in the composer will show up here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {media.map((item) => {
        const previewUrl = previews[item.storage_key] ?? null;
        return (
          <Card key={item.storage_key} flush>
            <div className="flex h-40 items-center justify-center overflow-hidden rounded-t-lg bg-gray-100">
              {item.type === 'image' && previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={item.prompt ?? 'Media file'} className="h-full w-full object-cover" />
              ) : item.type === 'video' && previewUrl ? (
                <video src={previewUrl} controls className="h-full w-full object-contain" />
              ) : (
                <span className="text-3xl">{item.type === 'video' ? '🎬' : item.type === 'image' ? '🖼' : '📄'}</span>
              )}
            </div>
            <div className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    item.source === 'generated' ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {item.source === 'generated' ? 'AI-generated' : 'Upload'}
                </span>
                <span className="text-gray-500">
                  {item.used_in_posts > 0
                    ? `Used in ${item.used_in_posts} ${item.used_in_posts === 1 ? 'post' : 'posts'}`
                    : 'Not used yet'}
                </span>
              </div>
              {item.prompt && (
                <p className="line-clamp-2 text-xs text-gray-500" title={item.prompt}>
                  {item.prompt}
                </p>
              )}
              {item.created_at && (
                <p className="text-xs text-gray-400">{dateFormatter.format(new Date(item.created_at))}</p>
              )}
              <div className="mt-1 flex items-center gap-3 border-t border-gray-100 pt-2 text-sm">
                <button
                  type="button"
                  onClick={() => useInComposer(item)}
                  className="font-medium text-primary-700 hover:underline"
                >
                  Use in composer
                </button>
                <a href={downloadHref(item.storage_key)} className="text-gray-600 hover:underline" download>
                  Download
                </a>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
