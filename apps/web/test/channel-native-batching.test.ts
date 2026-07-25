// Kanal-native Erzeugung (Plan 2 / 2B.3) — die Kostenseite.
//
// Der Plan sagt: 75 Posts x 4 Kanäle wären 300 statt 75 LLM-Aufrufe. Batching
// pro Konzept hält das beherrschbar, und die Schätzung muss VOR dem Lauf
// stimmen — eine Schätzung, die man erst hinterher prüfen kann, ist keine.
import { describe, expect, test } from 'vitest';
import { CREDIT_COSTS } from '@prolora/shared';
import {
  channelStyleRules,
  channelTargetFromConnection,
  chunkChannels,
  defaultFormatFor,
  estimateChannelNativeCredits,
  MAX_CHANNELS_PER_CALL,
  type ChannelTarget,
} from '@/lib/pipeline/channel-native';
import { PLATFORM_STYLE } from '@/lib/ai/adapt-content';

describe('Credit-Schätzung vor dem Lauf', () => {
  test('75 Posts x 4 Kanäle kosten 75 Aufrufe statt 300', () => {
    const estimate = estimateChannelNativeCredits({ conceptCount: 75, channelCount: 4 });
    expect(estimate.calls).toBe(75);
    expect(estimate.naiveCredits).toBe(300 * CREDIT_COSTS.content_adaptation);
    expect(estimate.credits).toBe(75 * CREDIT_COSTS.content_adaptation);
    expect(estimate.savedCredits).toBe(estimate.naiveCredits - estimate.credits);
  });

  test('mehr Kanäle als ein Batch fasst ergeben mehrere Aufrufe je Konzept', () => {
    const estimate = estimateChannelNativeCredits({ conceptCount: 2, channelCount: 9 });
    // ceil(9/4) = 3 Aufrufe je Konzept
    expect(estimate.calls).toBe(6);
  });

  test('ohne Kanäle kostet nichts', () => {
    expect(estimateChannelNativeCredits({ conceptCount: 10, channelCount: 0 })).toMatchObject({
      calls: 0,
      credits: 0,
      naiveCredits: 0,
      savedCredits: 0,
    });
  });

  test('die Batch-Größe ist einstellbar', () => {
    expect(
      estimateChannelNativeCredits({ conceptCount: 1, channelCount: 8, maxChannelsPerCall: 8 }).calls
    ).toBe(1);
  });
});

describe('Batch-Bildung', () => {
  test('Kanäle werden in Blöcke der Batch-Größe zerlegt', () => {
    const chunks = chunkChannels([1, 2, 3, 4, 5, 6, 7, 8, 9], MAX_CHANNELS_PER_CALL);
    expect(chunks.map((chunk) => chunk.length)).toEqual([4, 4, 1]);
    expect(chunks.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('eine leere Kanalliste ergibt keinen Block', () => {
    expect(chunkChannels([])).toEqual([]);
  });
});

describe('PLATFORM_STYLE bleibt die Regelquelle', () => {
  test('die Kanal-Regeln enthalten die Plattform-Regel unverändert', () => {
    const target: ChannelTarget = {
      channelKey: 'conn-1',
      platform: 'linkedin',
      connectionId: 'conn-1',
      accountLabel: 'Prolora',
      characterLimit: 3000,
      format: 'post',
    };
    const rules = channelStyleRules(target);
    expect(rules).toContain(PLATFORM_STYLE.linkedin);
    expect(rules).toContain('3000');
    expect(rules).toContain('Prolora');
  });

  test('Kanal-Regeln unterscheiden Format, nicht nur Plattform', () => {
    const post = channelStyleRules({
      channelKey: 'a',
      platform: 'linkedin',
      connectionId: null,
      characterLimit: 3000,
      format: 'post',
    });
    const thread = channelStyleRules({
      channelKey: 'b',
      platform: 'x',
      connectionId: null,
      characterLimit: 280,
      format: 'thread',
    });
    expect(post).not.toEqual(thread);
    expect(thread).toContain('PER SEGMENT');
  });
});

describe('Format-Ableitung je Kanal', () => {
  test('X wird ein Thread, LinkedIn ein Post, Dev.to ein Artikel', () => {
    expect(defaultFormatFor('x')).toBe('thread');
    expect(defaultFormatFor('linkedin')).toBe('post');
    expect(defaultFormatFor('devto')).toBe('article');
    expect(defaultFormatFor('hashnode')).toBe('article');
  });

  test('ein Kanal ohne Verbindung bekommt einen stabilen Schlüssel', () => {
    expect(
      channelTargetFromConnection({ connectionId: null, platform: 'bluesky' }).channelKey
    ).toBe('platform:bluesky');
    expect(
      channelTargetFromConnection({ connectionId: 'c-9', platform: 'bluesky' }).channelKey
    ).toBe('c-9');
  });
});
