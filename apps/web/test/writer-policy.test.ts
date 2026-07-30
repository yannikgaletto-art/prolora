import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_WRITER_POLICY,
  policyFromRow,
  type WriterPolicyRow,
} from '@/lib/writer/policy';

const migration = readFileSync(
  resolve(process.cwd(), '../../supabase/migrations/022_writer_pilot.sql'),
  'utf8'
);

describe('Writer policy defaults', () => {
  test('is paused and approval-required with conservative caps', () => {
    expect(DEFAULT_WRITER_POLICY).toEqual({
      enabled: false,
      mode: 'approval_required',
      allowedConnectionIds: [],
      dailyPostCap: 1,
      weeklyCreditCap: 10,
      minimumSignalStrength: 0.6,
      contentMix: {},
      quietDays: [],
      timezone: 'Europe/Berlin',
      dnaProfileId: null,
      policyVersion: 1,
    });
  });

  test('maps only explicit persisted policy columns', () => {
    const row: WriterPolicyRow = {
      workspace_id: 'workspace-1',
      enabled: true,
      mode: 'approval_required',
      allowed_connection_ids: ['connection-1'],
      daily_post_cap: 2,
      weekly_credit_cap: 8,
      minimum_signal_strength: 0.75,
      content_mix: { insight: 1 },
      quiet_days: [0, 6],
      timezone: 'UTC',
      dna_profile_id: 'dna-1',
      policy_version: 4,
      updated_by: 'user-1',
      created_at: '2026-07-30T12:00:00.000Z',
      updated_at: '2026-07-30T12:00:00.000Z',
    };

    expect(policyFromRow(row)).toMatchObject({
      enabled: true,
      mode: 'approval_required',
      allowedConnectionIds: ['connection-1'],
      dailyPostCap: 2,
      policyVersion: 4,
    });
    expect(policyFromRow(row)).not.toHaveProperty('workspace_id');
  });
});

describe('migration 022 policy contract', () => {
  test('creates approval-only policies with conservative database defaults', () => {
    const table = migration.match(
      /CREATE TABLE IF NOT EXISTS workspace_writer_policies[\s\S]*?\n\);/
    )?.[0];
    expect(table).toBeDefined();
    expect(table).toMatch(/enabled BOOLEAN NOT NULL DEFAULT false/);
    expect(table).toMatch(/mode TEXT NOT NULL DEFAULT 'approval_required'/);
    expect(table).toMatch(/CHECK \(mode = 'approval_required'\)/);
    expect(table).toMatch(/daily_post_cap INTEGER NOT NULL DEFAULT 1/);
    expect(table).toMatch(/weekly_credit_cap INTEGER NOT NULL DEFAULT 10/);
    expect(table).toMatch(/minimum_signal_strength REAL NOT NULL DEFAULT 0\.6/);
    expect(table).not.toMatch(/auto_publish/);
  });

  test('uses workspace RLS and does not grant authenticated deletion', () => {
    expect(migration).toMatch(
      /ALTER TABLE workspace_writer_policies ENABLE ROW LEVEL SECURITY/
    );
    expect(migration).toMatch(
      /CREATE POLICY "workspace_writer_policies_read"[\s\S]*?user_workspace_ids\(\)/
    );
    expect(migration).not.toMatch(/CREATE POLICY "workspace_writer_policies_write"/);
    expect(migration).not.toMatch(/CREATE POLICY "workspace_writer_policies_update"/);
    expect(migration).not.toMatch(/workspace_writer_policies_delete/);
  });

  test('mutates versions atomically through a service-only RPC', () => {
    const fn = migration.match(
      /CREATE OR REPLACE FUNCTION update_writer_policy_atomic[\s\S]*?\n\$\$;/
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/p_expected_version INTEGER/);
    expect(fn).toMatch(/FOR UPDATE/);
    expect(fn).toMatch(/policy_version = p_expected_version \+ 1/);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION update_writer_policy_atomic[\s\S]*?authenticated/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION update_writer_policy_atomic[\s\S]*?service_role/
    );
  });
});
