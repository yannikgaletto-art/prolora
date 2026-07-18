import { isValidTimeZone } from './slot-allocator';

export type ScheduleFrequency = 1 | 3 | 5;

export interface PublishedForTiming {
  published_at: string | null;
  metrics: Record<string, unknown> | null;
}

export const RECOMMENDED_POSTS_PER_WEEK = { min: 2, max: 5 } as const;
const MIN_METRIC_POSTS = 30;

const FALLBACKS: Record<ScheduleFrequency, Array<{ day_of_week: number; local_time: string }>> = {
  1: [{ day_of_week: 3, local_time: '09:00:00' }],
  3: [
    { day_of_week: 2, local_time: '09:00:00' },
    { day_of_week: 3, local_time: '12:00:00' },
    { day_of_week: 4, local_time: '09:00:00' },
  ],
  5: [
    { day_of_week: 1, local_time: '09:00:00' },
    { day_of_week: 2, local_time: '09:00:00' },
    { day_of_week: 3, local_time: '12:00:00' },
    { day_of_week: 4, local_time: '09:00:00' },
    { day_of_week: 5, local_time: '09:00:00' },
  ],
};

export function buildSeedSlots(input: {
  frequency: ScheduleFrequency;
  timezone: string;
  published: PublishedForTiming[];
}): {
  source: 'metrics' | 'fallback';
  slots: Array<{ day_of_week: number; local_time: string }>;
} {
  if (![1, 3, 5].includes(input.frequency)) throw new Error('frequency must be 1, 3 or 5');
  if (!isValidTimeZone(input.timezone)) throw new Error('invalid IANA timezone');
  if (input.published.length < MIN_METRIC_POSTS) {
    return { source: 'fallback', slots: FALLBACKS[input.frequency] };
  }

  const buckets = new Map<string, { day: number; time: string; total: number; count: number }>();
  for (const post of input.published) {
    if (!post.published_at) continue;
    const date = new Date(post.published_at);
    if (!Number.isFinite(date.getTime())) continue;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: input.timezone,
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday ?? '');
    const hour = parts.find((part) => part.type === 'hour')?.value;
    if (day < 0 || !hour) continue;
    const time = `${hour}:00:00`;
    const key = `${day}:${time}`;
    const current = buckets.get(key) ?? { day, time, total: 0, count: 0 };
    current.total += weightedEngagement(post.metrics);
    current.count++;
    buckets.set(key, current);
  }
  const best = [...buckets.values()]
    .sort((a, b) => b.total / b.count - a.total / a.count || b.count - a.count)
    .map((bucket) => ({ day_of_week: bucket.day, local_time: bucket.time }));
  const merged = [...best, ...FALLBACKS[input.frequency]].filter(
    (slot, index, all) => all.findIndex((candidate) =>
      candidate.day_of_week === slot.day_of_week && candidate.local_time === slot.local_time
    ) === index
  );
  return { source: 'metrics', slots: merged.slice(0, input.frequency) };
}

function weightedEngagement(metrics: Record<string, unknown> | null): number {
  const value = (key: string) => typeof metrics?.[key] === 'number' ? metrics[key] as number : 0;
  return value('likes') + value('shares') * 2 + value('comments') * 3;
}
