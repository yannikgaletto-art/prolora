// A row leads with what was said and carries its source's mark on the left,
// so scanning the list answers "where did this come from?" without reading
// the raw source_platform token the old layout printed in 12px grey.
import type { AppLocale } from '@prolora/shared';
import type { FeedbackListItem } from '@/lib/feedback/list-feedback';
import { Badge } from '@/app/components/Badge';
import { getRun7Dict, type Run7Dict } from '@/lib/i18n/run7';
import { SourceMark, resolveSourceKey, sourceLabel } from './source-meta';

const DATE_LOCALE: Record<AppLocale, string> = { de: 'de-DE', en: 'en-US', es: 'es-ES' };

type ListenDict = Run7Dict['listen'];

// The DB columns are free-form enough that an unmapped value must degrade to
// the raw string rather than render blank.
function label(map: Record<string, string>, value: string): string {
  return map[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function FeedbackRow({ item, locale }: { item: FeedbackListItem; locale: AppLocale }) {
  const dict: ListenDict = getRun7Dict(locale).listen;
  const source = resolveSourceKey(item.source_platform);
  const preview =
    item.original_content.length > 160
      ? `${item.original_content.slice(0, 160)}…`
      : item.original_content;
  const date = item.source_date ?? item.created_at;
  const formattedDate = new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-gray-50">
          <SourceMark source={source} title={sourceLabel(dict, source)} />

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-gray-900">{preview}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500">
              <span className="font-medium text-gray-700">{sourceLabel(dict, source)}</span>
              <span className="text-gray-300">·</span>
              <span>{item.source_author ?? dict.anonymous}</span>
              <span className="text-gray-300">·</span>
              <span>{formattedDate}</span>
              {item.is_duplicate && (
                <Badge tone="gray" className="text-[10px]">
                  {dict.duplicate}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            {item.sentiment && (
              <Badge status={item.sentiment}>{label(dict.sentimentLabels, item.sentiment)}</Badge>
            )}
            {item.category && (
              <Badge tone="teal">{label(dict.categoryLabels, item.category)}</Badge>
            )}
            {item.urgency && (item.urgency === 'high' || item.urgency === 'critical') && (
              <Badge status={item.urgency}>{label(dict.urgencyLabels, item.urgency)}</Badge>
            )}
          </div>
        </summary>

        <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-3 pl-11">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {dict.fullFeedback}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
              {item.original_content}
            </p>
          </div>

          {item.summary_en && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {dict.aiSummary}
              </p>
              <p className="mt-1 text-sm text-gray-700">{item.summary_en}</p>
            </div>
          )}

          {item.suggested_action && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {dict.suggestedAction}
              </p>
              <p className="mt-1 text-sm text-gray-700">{item.suggested_action}</p>
            </div>
          )}

          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              {dict.viewSource} →
            </a>
          )}
        </div>
      </details>
    </li>
  );
}
