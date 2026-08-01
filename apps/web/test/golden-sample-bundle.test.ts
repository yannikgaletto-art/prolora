import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  maskGoldenSample,
  parseGoldenSampleBundle,
} from '@/lib/writer/golden-bundle';
import { analyzeContentDna } from '@/lib/writer/dna';
import { hashSampleSet } from '@/lib/writer/hash';

const files = [
  'polarisierung.md',
  'inside-the-room.md',
  'failure-und-learning.md',
  'mission-und-gemeinwohl.md',
];

describe('curated Golden Sample bundle', () => {
  test('parses the four source documents into twelve metadata-rich samples', () => {
    const samples = files.flatMap((file) =>
      parseGoldenSampleBundle(
        readFileSync(resolve(process.cwd(), '../../golden-samples', file), 'utf8'),
        file,
        '2026-08-01'
      )
    );

    expect(samples).toHaveLength(12);
    expect(new Set(samples.map((sample) => sample.bundleKey)).size).toBe(12);
    expect(samples.every((sample) => sample.language === 'de')).toBe(true);
    expect(samples.find((sample) => sample.platform === 'x')?.contentFormat).toMatch(/thread|single_post/);
    expect(samples.every((sample) => sample.category && sample.hookType)).toBe(true);
  });

  test('masks facts, placeholders, links and names before prompt use', () => {
    const masked = maskGoldenSample(
      'Pathly hatte 86 User, wuchs 22 % und kostete 1.280 € in [X Monaten]. https://pathly.app'
    );

    expect(masked).not.toMatch(/Pathly|86|22|1\.280|€|\[X|pathly\.app/i);
    expect(masked).toContain('[PRODUCT]');
    expect(masked).toContain('[METRIC]');
    expect(masked).toContain('[PLACEHOLDER]');
    expect(masked).toContain('[LINK]');
  });

  test('changes the sample-set hash when prompt-relevant metadata changes', () => {
    const base = {
      kind: 'golden' as const,
      contentHash: 'a'.repeat(64),
      maskedContentHash: 'b'.repeat(64),
      platform: 'linkedin',
      category: 'failure',
      hookType: 'confession',
      contentFormat: 'single_post',
      active: true,
    };

    expect(hashSampleSet([base])).not.toBe(hashSampleSet([{ ...base, platform: 'x' }]));
    expect(hashSampleSet([base])).not.toBe(hashSampleSet([{ ...base, active: false }]));
  });

  test('turns active avoid samples into negative prompt rules', () => {
    const result = analyzeContentDna([
      ...Array.from({ length: 3 }, (_, index) => ({
        kind: 'golden' as const,
        content: `Ich lerne öffentlich aus Fehler ${index}. Was meint ihr?`,
      })),
      { kind: 'avoid', content: 'In der heutigen schnelllebigen Welt ist KI ein Gamechanger.' },
    ]);

    expect(result.promptRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'avoid_1', instruction: expect.stringMatching(/Never imitate/i) }),
      ])
    );
  });
});
