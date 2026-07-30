export type WriterSection = 'today' | 'dna' | 'history';
export type WriterAvailability = 'ready' | 'setup' | 'migration_pending' | 'unavailable';
export type WriterConfidenceTier = 'low' | 'preliminary' | 'reliable' | 'precise';
export type WriterSampleKind = 'golden' | 'avoid';
export type WriterSampleOrigin = 'pasted' | 'imported' | 'published';

export interface WriterClaim {
  text: string;
  sourceLabel: string;
  sourceUrl: string | null;
  verified: boolean;
}

export interface WriterMedia {
  type: 'image' | 'video' | 'document';
  label: string;
  altText: string | null;
}

export interface WriterChannelPreview {
  id: string;
  platform: string;
  accountName: string;
  format: 'post' | 'thread' | 'article';
  content: string;
  segments: string[];
  media: WriterMedia[];
  firstComment: string | null;
  gatePassed: boolean;
}

export interface WriterReview {
  id: string;
  snapshotHash: string;
  title: string;
  preview: string;
  whyNow: string;
  proposedLocalTime: string;
  timezone: string;
  proposedUtcTime: string;
  dnaVersion: number | null;
  dnaSampleCount: number;
  sourceCount: number;
  warnings: string[];
  skippedChecks: string[];
  overrides: string[];
  changes: string[];
  claims: WriterClaim[];
  channels: WriterChannelPreview[];
}

export interface WriterPolicy {
  enabled: boolean;
  mode: 'approval_required';
  dailyPostCap: number;
  weeklyCreditCap: number;
  timezone: string;
}

export interface WriterDnaSample {
  id: string;
  kind: WriterSampleKind;
  origin: WriterSampleOrigin;
  label: string;
  platform: string | null;
  active: boolean;
}

export interface WriterDna {
  version: number | null;
  status: 'missing' | 'building' | 'active' | 'failed' | 'superseded';
  sampleCount: number;
  goldenSampleCount: number;
  avoidSampleCount: number;
  confidence: WriterConfidenceTier | null;
  traits: string[];
  lockedRules: string[];
  samples: WriterDnaSample[];
}

export interface WriterHistoryEntry {
  id: string;
  title: string;
  status: 'approved' | 'rejected' | 'invalidated' | 'expired' | 'pending';
  occurredAt: string;
  detail: string;
}

export interface WriterUiData {
  availability: WriterAvailability;
  workspaceName: string;
  policy: WriterPolicy;
  stats: {
    awaitingApproval: number;
    preparing: number;
    goldenSamples: number;
    exceptions: number;
  };
  dna: WriterDna;
  pendingReview: WriterReview | null;
  history: WriterHistoryEntry[];
}

export const DEFAULT_WRITER_POLICY: WriterPolicy = {
  enabled: false,
  mode: 'approval_required',
  dailyPostCap: 1,
  weeklyCreditCap: 10,
  timezone: 'Europe/Berlin',
};

export const EMPTY_WRITER_DNA: WriterDna = {
  version: null,
  status: 'missing',
  sampleCount: 0,
  goldenSampleCount: 0,
  avoidSampleCount: 0,
  confidence: null,
  traits: [],
  lockedRules: [],
  samples: [],
};

export function nextWriterSection(
  current: WriterSection,
  key: string,
  sections: readonly WriterSection[]
): WriterSection {
  if (sections.length === 0) return current;
  if (key === 'Home') return sections[0];
  if (key === 'End') return sections[sections.length - 1];
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return current;

  const currentIndex = Math.max(0, sections.indexOf(current));
  const direction = key === 'ArrowRight' ? 1 : -1;
  return sections[(currentIndex + direction + sections.length) % sections.length];
}

export function dnaConfidenceTier(
  sampleCount: number
): WriterConfidenceTier {
  if (sampleCount >= 15) return 'precise';
  if (sampleCount >= 5) return 'reliable';
  if (sampleCount >= 3) return 'preliminary';
  return 'low';
}

export function reviewHasApprovalContext(
  review: WriterReview,
  selectedChannelIds: readonly string[] = review.channels.map((channel) => channel.id)
): boolean {
  const selectedChannels = review.channels.filter((channel) =>
    selectedChannelIds.includes(channel.id)
  );
  if (
    !review.id ||
    !review.snapshotHash ||
    !review.proposedLocalTime ||
    !review.proposedUtcTime ||
    !review.timezone ||
    selectedChannels.length === 0 ||
    review.sourceCount < 1 ||
    review.claims.length === 0
  ) {
    return false;
  }
  return selectedChannels.every(
    (channel) =>
      Boolean(channel.id && channel.platform && channel.accountName && channel.content.trim()) &&
      channel.gatePassed
  );
}
