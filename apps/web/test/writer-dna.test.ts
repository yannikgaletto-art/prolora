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
    const content = [
      'I build products. I learn fast!',
      '',
      '- Try this',
      '- Ship today',
      '',
      'What will you build?',
      '',
      'Join the waitlist.',
    ].join('\n');
    const result = analyzeContentDna(Array.from({ length: 3 }, () => golden(content)));

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

  test('keeps the profile neutral with one or two Golden Samples', () => {
    const locked: DnaLockedRule = {
      key: 'sentence_length',
      instruction: 'Keep sentences short.',
      locked: true,
    };
    const result = analyzeContentDna(
      [
        golden('I use a highly distinctive opening and an unusually long sentence here.'),
        golden('Why would two examples be enough to claim a precise style?'),
      ],
      [locked]
    );

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
    expect(result.promptRules).toEqual([locked]);
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

  test('keeps direct RLS access read-only and all writes behind service-role RPCs', () => {
    expect(migration).toMatch(/ALTER TABLE content_samples ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(
      /CREATE POLICY "content_samples_workspace_read"[\s\S]*?FOR SELECT[\s\S]*?user_workspace_ids\(\)/
    );
    expect(migration).not.toMatch(/CREATE POLICY "content_samples_workspace_write"/);

    expect(migration).toMatch(/ALTER TABLE content_dna_profiles ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(
      /CREATE POLICY "content_dna_profiles_workspace_read"[\s\S]*?user_workspace_ids\(\)/
    );
    expect(migration).not.toMatch(/CREATE POLICY "content_dna_profiles_workspace_insert"/);
    expect(migration).not.toMatch(/CREATE POLICY "content_dna_profiles_workspace_update"/);
  });

  test('serializes sample mutations and profile replacement through service-role-only RPCs', () => {
    for (const functionName of [
      'create_content_sample_atomic',
      'update_content_sample_atomic',
      'delete_content_sample_atomic',
      'rebuild_content_dna_atomic',
    ]) {
      const body = migration.match(
        new RegExp(`CREATE OR REPLACE FUNCTION ${functionName}[\\s\\S]*?\\$\\$;`)
      )?.[0];
      expect(body).toBeDefined();
      expect(body).toMatch(/SECURITY DEFINER/);
      expect(body).toMatch(/SET search_path\s*=\s*public/);
      expect(body).toMatch(/pg_advisory_xact_lock/);
      expect(body).toMatch(/workspace_id/);
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION ${functionName}[\\s\\S]*?authenticated`)
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION ${functionName}[\\s\\S]*?service_role`)
      );
    }

    const rebuild = migration.match(
      /CREATE OR REPLACE FUNCTION rebuild_content_dna_atomic[\s\S]*?\$\$;/
    )?.[0];
    expect(rebuild).toMatch(/content_sample_set_changed/);
    expect(rebuild).toMatch(/MAX\(dna\.version\)/);
    expect(rebuild).toMatch(/status = 'superseded'/);
    expect(rebuild).toMatch(/status = 'active'/);
    expect(rebuild).toMatch(/IF NOT FOUND[\s\S]*?content_dna_activation_failed/);
    expect(migration).toMatch(/prompt_rules JSONB NOT NULL/);
  });
});
