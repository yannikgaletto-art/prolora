import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  analyzeContentDna,
  CONTENT_DNA_FEATURE_KEYS,
  profileConfidence,
} from '@/lib/writer/dna';
import type { DnaLockedRule, DnaSampleInput } from '@/lib/writer/types';

const migration = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/021_content_dna.sql'),
  'utf8'
);

function golden(content: string, active = true): DnaSampleInput {
  return { kind: 'golden', content, active };
}

describe('content DNA confidence', () => {
  test('uses honest cold-start tiers', () => {
    expect(profileConfidence(0)).toBe('low');
    expect(profileConfidence(2)).toBe('low');
    expect(profileConfidence(3)).toBe('provisional');
    expect(profileConfidence(4)).toBe('provisional');
    expect(profileConfidence(5)).toBe('usable');
    expect(profileConfidence(14)).toBe('usable');
    expect(profileConfidence(15)).toBe('precise');
  });

  test('counts only active Golden Samples toward profile confidence', () => {
    const result = analyzeContentDna([
      golden('I write one clear sentence.'),
      golden('This inactive sample must not count.', false),
      { kind: 'avoid', content: 'Never imitate this.', active: true },
    ]);

    expect(result.sampleCount).toBe(1);
    expect(result.confidence.overall).toBe('low');
    for (const key of CONTENT_DNA_FEATURE_KEYS) {
      expect(result.confidence.features[key]).toEqual({
        level: 'low',
        sampleCount: 1,
      });
    }
  });
});

describe('deterministic content DNA extraction', () => {
  test('derives transparent structural and voice features', () => {
    const result = analyzeContentDna([
      golden(
        [
          'I build products. I learn fast!',
          '',
          '- Try this',
          '- Ship today',
          '',
          'What will you build?',
          '',
          'Join the waitlist.',
        ].join('\n')
      ),
    ]);

    expect(result.profile.medianSentenceLength).toBe(3);
    expect(result.profile.medianParagraphLength).toBe(4);
    expect(result.profile.firstPersonRate).toBeGreaterThan(0);
    expect(result.profile.questionRate).toBeGreaterThan(0);
    expect(result.profile.exclamationRate).toBeGreaterThan(0);
    expect(result.profile.listUsage).toBe(1);
    expect(result.profile.ctaPresence).toBe(1);
    expect(result.profile.commonOpeningShapes).toEqual(['first_person']);
    expect(result.profile.preferredWhitespaceDensity).toBeGreaterThan(0);
  });

  test('returns a neutral low-confidence fallback without Golden Samples', () => {
    const result = analyzeContentDna([]);

    expect(result.profile).toEqual({
      medianSentenceLength: 0,
      medianParagraphLength: 0,
      firstPersonRate: 0,
      questionRate: 0,
      exclamationRate: 0,
      listUsage: 0,
      ctaPresence: 0,
      commonOpeningShapes: [],
      preferredWhitespaceDensity: 0,
    });
    expect(result.confidence.overall).toBe('low');
    expect(result.promptRules).toEqual([]);
  });

  test('preserves locked user rules and lets them replace a derived rule', () => {
    const locked: DnaLockedRule = {
      key: 'sentence_length',
      instruction: 'Keep every sentence under eight words.',
      locked: true,
    };
    const result = analyzeContentDna(
      Array.from({ length: 5 }, () =>
        golden('This sentence deliberately contains many words for a stable learned preference.')
      ),
      [locked]
    );

    expect(result.promptRules.filter((rule) => rule.key === locked.key)).toEqual([locked]);
    expect(result.lockedRules).toEqual([locked]);
  });

  test('is deterministic for identical active Golden Samples', () => {
    const samples = [
      golden('Why does this work?\n\nI explain the reason clearly.'),
      golden('Here is the lesson.\n\nTry it today.'),
    ];

    expect(analyzeContentDna(samples)).toEqual(analyzeContentDna(samples));
  });
});

describe('migration 021 content DNA contract', () => {
  test('creates workspace-scoped sample storage with duplicate protection', () => {
    const samplesTable = migration.match(
      /CREATE TABLE IF NOT EXISTS content_samples[\s\S]*?\n\);/
    )?.[0];

    expect(samplesTable).toBeDefined();
    expect(samplesTable).toMatch(/workspace_id UUID NOT NULL REFERENCES workspaces/);
    expect(samplesTable).toMatch(/kind TEXT NOT NULL CHECK \(kind IN \('golden', 'avoid'\)\)/);
    expect(samplesTable).toMatch(/origin TEXT NOT NULL CHECK \(origin IN \('pasted', 'published', 'imported'\)\)/);
    expect(samplesTable).toMatch(/embedding VECTOR\(1536\)/);
    expect(migration).toMatch(/UNIQUE \(workspace_id, kind, content_hash\)/);
    expect(migration).toMatch(/idx_content_samples_workspace/);
  });

  test('creates immutable versioned profiles with one active profile per workspace', () => {
    const profilesTable = migration.match(
      /CREATE TABLE IF NOT EXISTS content_dna_profiles[\s\S]*?\n\);/
    )?.[0];

    expect(profilesTable).toBeDefined();
    expect(profilesTable).toMatch(/workspace_id UUID NOT NULL REFERENCES workspaces/);
    expect(profilesTable).toMatch(/UNIQUE \(workspace_id, version\)/);
    expect(profilesTable).toMatch(/locked_rules JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_content_dna_active\s+ON content_dna_profiles \(workspace_id\)\s+WHERE status = 'active'/
    );
    expect(migration).toMatch(/guard_content_dna_profile_mutation/);
    expect(migration).toMatch(
      /CREATE TRIGGER trg_content_dna_profiles_immutable\s+BEFORE UPDATE ON content_dna_profiles/
    );
    expect(migration).not.toMatch(
      /CREATE TRIGGER trg_content_dna_profiles_immutable\s+BEFORE UPDATE OR DELETE/
    );
  });

  test('enforces workspace RLS for reads and writes on both tables', () => {
    expect(migration).toMatch(/ALTER TABLE content_samples ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/CREATE POLICY "content_samples_workspace"[\s\S]*?USING \(workspace_id IN \(SELECT public\.user_workspace_ids\(\)\)\)[\s\S]*?WITH CHECK \(workspace_id IN \(SELECT public\.user_workspace_ids\(\)\)\)/);

    expect(migration).toMatch(/ALTER TABLE content_dna_profiles ENABLE ROW LEVEL SECURITY/);
    for (const operation of ['read', 'insert', 'update']) {
      expect(migration).toMatch(
        new RegExp(
          `CREATE POLICY "content_dna_profiles_workspace_${operation}"[\\s\\S]*?user_workspace_ids\\(\\)`
        )
      );
    }
    expect(migration).not.toMatch(/CREATE POLICY "content_dna_profiles_workspace_delete"/);
  });
});
