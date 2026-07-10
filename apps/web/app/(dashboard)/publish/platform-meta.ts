import type { PlatformType } from '@prolora/shared';

// Shared between the composer and the posts table so every platform chip in
// /publish looks the same. Same colors as app/(dashboard)/connections/ConnectionsView.tsx
// (kept in sync by eye — there is no shared design-token export for this yet).
export const PLATFORM_META: Record<PlatformType, { label: string; initial: string; color: string }> = {
  linkedin: { label: 'LinkedIn', initial: 'in', color: '#0A66C2' },
  x: { label: 'X', initial: 'X', color: '#000000' },
  bluesky: { label: 'Bluesky', initial: 'B', color: '#1185FE' },
  mastodon: { label: 'Mastodon', initial: 'M', color: '#6364FF' },
  telegram: { label: 'Telegram', initial: 'T', color: '#26A5E4' },
};
