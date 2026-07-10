import type { ReactNode } from 'react';

// One colour vocabulary for every status in the product: green = done,
// red = broken, amber = waiting, grey = inert, teal = in flight.
const TONES = {
  green: 'bg-green-50 text-green-700 ring-green-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  gray: 'bg-gray-50 text-gray-600 ring-gray-500/20',
  teal: 'bg-primary-50 text-primary-700 ring-primary-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
} as const;

export type BadgeTone = keyof typeof TONES;

// Post + connection + board + feedback statuses share this map. Unknown values
// fall back to grey rather than crashing on an unmapped key.
const STATUS_TONES: Record<string, BadgeTone> = {
  // Posts
  published: 'green',
  failed: 'red',
  scheduled: 'amber',
  queued: 'gray',
  publishing: 'teal',
  deleted: 'gray',
  // Connections
  active: 'green',
  expired: 'red',
  revoked: 'red',
  error: 'red',
  // Board
  open: 'gray',
  planned: 'blue',
  in_progress: 'teal',
  shipped: 'green',
  declined: 'red',
  // Feedback sentiment
  positive: 'green',
  negative: 'red',
  neutral: 'gray',
  mixed: 'amber',
  // Feedback urgency
  low: 'gray',
  medium: 'blue',
  high: 'amber',
  critical: 'red',
};

const LABELS: Record<string, string> = {
  in_progress: 'In Progress',
};

function humanize(value: string): string {
  return LABELS[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export interface BadgeProps {
  /** A known status string — colour is derived automatically. */
  status?: string;
  /** Overrides the derived colour. */
  tone?: BadgeTone;
  children?: ReactNode;
  className?: string;
}

export function Badge({ status, tone, children, className = '' }: BadgeProps) {
  const resolved = tone ?? (status ? (STATUS_TONES[status] ?? 'gray') : 'gray');
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${TONES[resolved]} ${className}`}
    >
      {children ?? (status ? humanize(status) : null)}
    </span>
  );
}
