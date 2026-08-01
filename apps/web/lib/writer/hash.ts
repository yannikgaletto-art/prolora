import { createHash } from 'node:crypto';
import type { CanonicalJsonValue, SampleSetHashInput } from './types';

function canonicalize(value: CanonicalJsonValue): CanonicalJsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, CanonicalJsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: CanonicalJsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashCanonicalJson(value: CanonicalJsonValue): string {
  return sha256Hex(canonicalJson(value));
}

export function hashSampleSet(samples: readonly SampleSetHashInput[]): string {
  const uniqueMembers = [...new Set(samples.map((sample) => canonicalJson({
    active: sample.active ?? true,
    category: sample.category ?? null,
    contentFormat: sample.contentFormat ?? null,
    contentHash: sample.contentHash,
    hookType: sample.hookType ?? null,
    kind: sample.kind,
    maskedContentHash: sample.maskedContentHash ?? null,
    platform: sample.platform ?? null,
  })))].sort();
  return hashCanonicalJson(uniqueMembers);
}
