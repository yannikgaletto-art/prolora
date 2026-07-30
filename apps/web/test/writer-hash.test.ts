import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  hashCanonicalJson,
  hashSampleSet,
  sha256Hex,
} from '@/lib/writer/hash';

describe('writer canonical hashing', () => {
  test('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalJson({
        z: [{ b: 1, a: 2 }, { d: 3, c: 4 }],
        b: true,
        a: { y: 'second', x: 'first' },
      })
    ).toBe(
      '{"a":{"x":"first","y":"second"},"b":true,"z":[{"a":2,"b":1},{"c":4,"d":3}]}'
    );

    expect(canonicalJson({ values: ['second', 'first'] })).not.toBe(
      canonicalJson({ values: ['first', 'second'] })
    );
  });

  test('produces stable SHA-256 hashes for canonically equivalent values', () => {
    const first = { nested: { b: 2, a: 1 }, enabled: true };
    const second = { enabled: true, nested: { a: 1, b: 2 } };

    expect(hashCanonicalJson(first)).toBe(hashCanonicalJson(second));
    expect(hashCanonicalJson(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Hex('writer')).toBe(
      'b93006774cbdd4b299389a03ac3d88c3a76b460d538795bc12718011a909fba5'
    );
  });

  test('hashes a sample set independently of query order and duplicate rows', () => {
    const samples = [
      { kind: 'golden' as const, contentHash: 'golden-hash' },
      { kind: 'avoid' as const, contentHash: 'avoid-hash' },
    ];

    expect(hashSampleSet(samples)).toBe(
      hashSampleSet([samples[1], samples[0], samples[0]])
    );
    expect(hashSampleSet(samples)).not.toBe(
      hashSampleSet([
        { kind: 'avoid', contentHash: 'golden-hash' },
        { kind: 'golden', contentHash: 'avoid-hash' },
      ])
    );
  });
});
