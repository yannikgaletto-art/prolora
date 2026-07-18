// GOAL-RUN8 T2.3: median/MAD calibration resists heavy-tail engagement
// outliers and degrades honestly for small or all-zero histories.

export const ENGAGEMENT_WEIGHTS = { likes: 1, comments: 2, shares: 3 } as const;
export const CALIBRATABLE_PLATFORMS = ['x', 'bluesky', 'mastodon'] as const;

const MODIFIED_Z_SCALE = 0.6745;

export interface Baseline {
  n: number;
  median: number;
  mad: number;
}

export type OutcomeBucket = 'below' | 'inline' | 'above' | 'outlier';

export interface ClassifiedOutcome {
  ratio: number;
  z: number | null;
  bucket: OutcomeBucket | null;
}

export interface ExpectationBand {
  low: number;
  median: number;
  high: number;
  n: number;
}

export function engagementScore(metrics: {
  likes?: number;
  comments?: number;
  shares?: number;
}): number {
  return (
    metric(metrics.likes) * ENGAGEMENT_WEIGHTS.likes +
    metric(metrics.comments) * ENGAGEMENT_WEIGHTS.comments +
    metric(metrics.shares) * ENGAGEMENT_WEIGHTS.shares
  );
}

export function computeBaseline(history: number[]): Baseline {
  const values = history
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.log1p(Math.max(0, value)))
    .sort((left, right) => left - right);
  if (values.length === 0) return { n: 0, median: 0, mad: 0 };

  const center = median(values);
  const deviations = values
    .map((value) => Math.abs(value - center))
    .sort((left, right) => left - right);
  return { n: values.length, median: center, mad: median(deviations) };
}

export function classifyOutcome(engagement: number, baseline: Baseline): ClassifiedOutcome {
  const logEngagement = Math.log1p(Math.max(0, metric(engagement)));
  const ratio = Number(Math.exp(logEngagement - baseline.median).toFixed(6));
  const z = baseline.n >= 20 && baseline.mad > 0
    ? MODIFIED_Z_SCALE * (logEngagement - baseline.median) / baseline.mad
    : null;

  if (baseline.n < 5) return { ratio, z: null, bucket: null };
  if (ratio > 3 || (z !== null && z >= 3.5)) return { ratio, z, bucket: 'outlier' };
  if (ratio < 0.5) return { ratio, z, bucket: 'below' };
  if (ratio <= 1.5) return { ratio, z, bucket: 'inline' };
  return { ratio, z, bucket: 'above' };
}

export function expectationBand(baseline: Baseline): ExpectationBand | null {
  if (baseline.n < 20) return null;
  return {
    low: Math.max(0, Math.round(Math.expm1(baseline.median - baseline.mad))),
    median: Math.max(0, Math.round(Math.expm1(baseline.median))),
    high: Math.max(0, Math.round(Math.expm1(baseline.median + baseline.mad))),
    n: baseline.n,
  };
}

function metric(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}
