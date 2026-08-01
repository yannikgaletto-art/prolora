import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildWriterReviewSnapshot, type WriterReviewSnapshotInput } from '@/lib/writer/reviews';

const input = (): WriterReviewSnapshotInput => ({
  contentItem: { id: 'item-1', title: 'Title', canonicalContent: 'Content', language: 'de', generationGroupId: 'group-1' },
  variants: [],
  proposedSlot: { scheduledAt: '2026-08-02T08:00:00.000Z', timezone: 'Europe/Berlin' },
  sources: { proofAssets: [], feedbackItemIds: [], referenceIds: [] },
  dna: { profileId: 'dna-1', version: 1 },
  generation: {
    language: 'de',
    contexts: [{
      platform: 'linkedin', factsHash: 'facts-a', sampleHash: 'samples-a',
      factIds: ['fact-1'], sampleIds: ['sample-1'],
      mention: { decision: 'omit', reason: 'cadence', placement: null, confidence: 0.9, ruleIds: ['cadence_cap'] },
      asOf: '2026-08-01T10:00:00.000Z',
    }],
  },
  versions: { prompt: 'v1', gate: 'narrative-gate-v1', policy: 1 },
});

describe('Writer narrative review snapshot', () => {
  test('hash-binds language, facts, samples and mention decision', () => {
    const original = buildWriterReviewSnapshot(input());
    const changed = input();
    changed.generation!.contexts[0].factsHash = 'facts-b';
    expect(buildWriterReviewSnapshot(changed).snapshotHash).not.toBe(original.snapshotHash);

    const mentionChanged = input();
    mentionChanged.generation!.contexts[0].mention.decision = 'include';
    expect(buildWriterReviewSnapshot(mentionChanged).snapshotHash).not.toBe(original.snapshotHash);
  });

  test('materializes writer posts and QA context in one transaction', () => {
    const migration = readFileSync(resolve(process.cwd(), '../../supabase/migrations/023_golden_samples_narrative_qa.sql'), 'utf8');
    const fn = migration.match(/CREATE OR REPLACE FUNCTION materialize_writer_bundle_with_qa[\s\S]*?\n\$\$;/)?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/materialize_writer_bundle\(/);
    expect(fn).toMatch(/UPDATE public\.post_items[\s\S]*qa_context/);
    expect(fn).toMatch(/snapshotHash/);
  });
});
