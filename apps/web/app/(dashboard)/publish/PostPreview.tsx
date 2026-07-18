'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AppLocale, MediaItem } from '@prolora/shared';
import { Badge } from '@/app/components/Badge';
import { Card } from '@/app/components/Card';
import type { ConnectionWithLimit } from '@/lib/connections/list-connections';
import { PLATFORM_META } from './platform-meta';
import { buildPostPreview } from './post-preview';
import { unicodeBold } from './post-preview';
import { getRun7Dict } from '@/lib/i18n/run7';

export function PostPreview({
  connections,
  selected,
  content,
  contentByConnection,
  firstComment,
  media,
  unicodeBoldEnabled,
  locale,
}: {
  connections: ConnectionWithLimit[];
  selected: Set<string>;
  content: string;
  contentByConnection: Record<string, string>;
  firstComment: string;
  media: Array<{ item: MediaItem; previewUrl: string | null }>;
  unicodeBoldEnabled: boolean;
  locale: AppLocale;
}) {
  const dict = getRun7Dict(locale).preview;
  const selectedConnections = useMemo(
    () => connections.filter((connection) => selected.has(connection.connection_id)),
    [connections, selected]
  );
  const [activeId, setActiveId] = useState<string | null>(selectedConnections[0]?.connection_id ?? null);

  useEffect(() => {
    if (!selectedConnections.some((connection) => connection.connection_id === activeId)) {
      setActiveId(selectedConnections[0]?.connection_id ?? null);
    }
  }, [activeId, selectedConnections]);

  if (selectedConnections.length === 0) return null;
  const active = selectedConnections.find((connection) => connection.connection_id === activeId) ?? selectedConnections[0];
  const preview = buildPostPreview({
    platform: active.platform,
    masterContent: unicodeBoldEnabled ? unicodeBold(content) : content,
    overrideContent: contentByConnection[active.connection_id]
      ? unicodeBoldEnabled ? unicodeBold(contentByConnection[active.connection_id]) : contentByConnection[active.connection_id]
      : undefined,
    firstComment: firstComment || undefined,
    characterLimit: active.character_limit,
  });

  return (
    <Card title={dict.title} description={dict.description}>
      <div className="mb-4 flex gap-2 overflow-x-auto" role="tablist" aria-label={dict.tabsLabel}>
        {selectedConnections.map((connection) => (
          <button
            key={connection.connection_id}
            type="button"
            role="tab"
            aria-selected={connection.connection_id === active.connection_id}
            onClick={() => setActiveId(connection.connection_id)}
            className={`rounded-md px-3 py-2 text-xs font-medium ${connection.connection_id === active.connection_id ? 'bg-primary-50 text-primary-800 ring-1 ring-primary-200' : 'bg-gray-50 text-gray-600'}`}
          >
            {PLATFORM_META[connection.platform].label} · {connection.account_name}
          </button>
        ))}
      </div>

      <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-gray-900">{active.account_name}</p>
          <Badge tone={preview.overLimit ? 'red' : 'gray'}>
            {preview.characterCount} / {preview.characterLimit}
          </Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm text-gray-900">{preview.content || dict.empty}</p>
        {media.map(({ item, previewUrl }, index) => (
          <div key={`${item.url}-${index}`} className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            {previewUrl && item.type === 'image' && <img src={previewUrl} alt={item.alt_text ?? dict.mediaAlt} className="max-h-80 w-full object-cover" />}
            {previewUrl && item.type === 'video' && <video src={previewUrl} controls className="max-h-80 w-full" />}
            {!previewUrl && <p className="p-3 text-xs text-gray-500">{dict.attached} {item.type}: {item.url}</p>}
          </div>
        ))}
        {preview.firstComment && (
          <div className="mt-4 border-t border-gray-200 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{dict.firstComment}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{preview.firstComment}</p>
          </div>
        )}
      </article>
      {preview.note && <p className="mt-2 text-xs text-amber-700">{preview.note}</p>}
      <p className="mt-2 text-xs text-gray-500">{dict.markdownWarning}</p>
    </Card>
  );
}
