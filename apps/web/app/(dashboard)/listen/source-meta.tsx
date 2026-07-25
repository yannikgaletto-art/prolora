// One visual identity per feedback source. The same glyph and colour appear
// on the source tile in SourceRail AND on every FeedbackRow that came from
// that source — that link is what makes "which source did this come from?"
// answerable at a glance instead of by reading a lowercase platform token.
//
// No 'use client': pure functions + inline SVG, so the Server Component list
// and the client-side rail can both import it.
import type { Run7Dict } from '@/lib/i18n/run7';

export type SourceKey = 'widget' | 'reddit' | 'other';

/** The sources the product can actually poll — lib/listeners/ has exactly these. */
export const CONNECTABLE_SOURCES = ['widget', 'reddit'] as const;

// raw_feedback.source_platform is a free-form string (the API ingest path can
// write anything), so anything we do not recognise collapses to 'other'
// rather than rendering an unstyled row.
export function resolveSourceKey(platform: string): SourceKey {
  return platform === 'widget' || platform === 'reddit' ? platform : 'other';
}

const CHIP: Record<SourceKey, string> = {
  widget: 'bg-primary-50 text-primary-700 ring-primary-600/20',
  reddit: 'bg-orange-50 text-orange-700 ring-orange-600/20',
  other: 'bg-gray-100 text-gray-500 ring-gray-500/20',
};

export function sourceLabel(dict: Run7Dict['listen'], source: SourceKey): string {
  if (source === 'widget') return dict.widgetTitle;
  if (source === 'reddit') return dict.redditTitle;
  return dict.otherSources;
}

export function sourceWhat(dict: Run7Dict['listen'], source: SourceKey): string {
  if (source === 'widget') return dict.widgetWhat;
  if (source === 'reddit') return dict.redditWhat;
  return dict.otherWhat;
}

// Deliberately abstract glyphs rather than platform logos: they stay legible
// at 16px, need no trademark handling, and read as "what kind of source"
// (own channel / community / machine) instead of "which vendor".
function Glyph({ source }: { source: SourceKey }) {
  if (source === 'widget') {
    // Speech bubble — feedback you asked for, on your own surface.
    return (
      <path
        d="M3 4.5A1.5 1.5 0 0 1 4.5 3h11A1.5 1.5 0 0 1 17 4.5v7A1.5 1.5 0 0 1 15.5 13H9l-3.5 3.25V13H4.5A1.5 1.5 0 0 1 3 11.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    );
  }
  if (source === 'reddit') {
    // Two figures — feedback overheard in a community.
    return (
      <>
        <circle cx="7.25" cy="6.5" r="2.25" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="13.5" cy="7.75" r="1.75" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M2.75 15.25c0-2.35 2-4 4.5-4s4.5 1.65 4.5 4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path
          d="M13.75 12.1c2 .3 3.5 1.6 3.5 3.15"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </>
    );
  }
  // Code brackets — feedback pushed in by a machine.
  return (
    <path
      d="M7.5 5 4 10l3.5 5M12.5 5 16 10l-3.5 5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

export function SourceIcon({
  source,
  className = 'h-4 w-4',
}: {
  source: SourceKey;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <Glyph source={source} />
    </svg>
  );
}

/**
 * The "all sources" counterpart. It exists mostly for alignment: without a
 * mark in the same slot, that tile's header row is shorter than its
 * neighbours' and its number sits on a different baseline.
 */
export function AllSourcesMark({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-500/20"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <path
          d="M10 2.75 17 6l-7 3.25L3 6l7-3.25Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="m3 10 7 3.25L17 10M3 14l7 3.25L17 14"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** The coloured square that carries the glyph. `title` is the accessible name. */
export function SourceMark({
  source,
  title,
  size = 'sm',
}: {
  source: SourceKey;
  title: string;
  size?: 'sm' | 'lg';
}) {
  const box = size === 'lg' ? 'h-9 w-9' : 'h-7 w-7';
  const icon = size === 'lg' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${CHIP[source]} ${box}`}
    >
      <SourceIcon source={source} className={icon} />
      <span className="sr-only">{title}</span>
    </span>
  );
}
