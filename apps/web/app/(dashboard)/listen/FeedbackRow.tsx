import type { FeedbackListItem } from '@/lib/feedback/list-feedback';
import { Badge } from '@/app/components/Badge';

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

// Generic speech-bubble glyph — platform-specific icons are not required.
function SourceGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-gray-400"
    >
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v7A1.5 1.5 0 0 1 15.5 13H9l-3.5 3.25V13H4.5A1.5 1.5 0 0 1 3 11.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FeedbackRow({ item }: { item: FeedbackListItem }) {
  const preview =
    item.original_content.length > 140
      ? `${item.original_content.slice(0, 140)}…`
      : item.original_content;
  const date = item.source_date ?? item.created_at;

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:bg-gray-50">
          <SourceGlyph />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-gray-900">
                {item.source_author ?? 'Anonymous'}
              </span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-500">{item.source_platform}</span>
              {item.is_duplicate && (
                <Badge tone="gray" className="text-[10px]">
                  Duplicate
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-gray-600">{preview}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              {item.sentiment && <Badge status={item.sentiment} />}
              {item.category && <Badge tone="teal">{humanize(item.category)}</Badge>}
              {item.urgency && (item.urgency === 'high' || item.urgency === 'critical') && (
                <Badge status={item.urgency} />
              )}
            </div>
            <span className="text-xs text-gray-400">{dateFormatter.format(new Date(date))}</span>
          </div>
        </summary>

        <div className="space-y-3 border-t border-gray-100 bg-gray-50 px-4 py-3 pl-11">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Full feedback
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
              {item.original_content}
            </p>
          </div>

          {item.summary_en && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                AI summary
              </p>
              <p className="mt-1 text-sm text-gray-700">{item.summary_en}</p>
            </div>
          )}

          {item.suggested_action && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Suggested action
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
              View original source →
            </a>
          )}
        </div>
      </details>
    </li>
  );
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
