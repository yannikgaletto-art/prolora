import { describe, expect, test } from 'vitest';
import { retrieveGoldenSamples } from '@/lib/writer/golden-bundle';

const sample = (id: string, platform: string | null, category: string, hookType: string) => ({
  id,
  kind: 'golden' as const,
  active: true,
  platform,
  category,
  hookType,
  contentFormat: 'single_post',
  maskedContent: `masked ${id}`,
  contentHash: id.padEnd(64, '0'),
});

describe('Golden Sample retrieval', () => {
  test('returns at most two platform/category matches and diversifies hook families', () => {
    const result = retrieveGoldenSamples(
      [
        sample('one', 'linkedin', 'failure', 'confession'),
        sample('two', 'linkedin', 'failure', 'confession'),
        sample('three', 'linkedin', 'failure', 'lesson'),
        sample('four', 'x', 'failure', 'thread'),
      ],
      { platform: 'linkedin', category: 'failure', recentSampleIds: [] }
    );

    expect(result).toHaveLength(2);
    expect(result.map((entry) => entry.id)).toEqual(['one', 'three']);
    expect(new Set(result.map((entry) => entry.hookType)).size).toBe(2);
  });

  test('never returns avoid, inactive, raw content, or recently used samples first', () => {
    const result = retrieveGoldenSamples(
      [
        { ...sample('recent', 'linkedin', 'failure', 'lesson'), content: 'SECRET RAW' },
        { ...sample('fresh', 'linkedin', 'failure', 'question'), content: 'SECRET RAW' },
        { ...sample('avoid', 'linkedin', 'failure', 'warning'), kind: 'avoid' as const },
        { ...sample('inactive', 'linkedin', 'failure', 'list'), active: false },
      ],
      { platform: 'linkedin', category: 'failure', recentSampleIds: ['recent'] }
    );

    expect(result[0]?.id).toBe('fresh');
    expect(result.every((entry) => !('content' in entry))).toBe(true);
  });
});
