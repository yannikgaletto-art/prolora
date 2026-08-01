import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/023_golden_samples_narrative_qa.sql'
);

describe('golden samples narrative QA schema contract', () => {
  const sql = () => readFileSync(migrationPath, 'utf8');

  test('extends samples with masked prompt context and retrieval metadata', () => {
    expect(sql()).toMatch(/ALTER TABLE content_samples[\s\S]*masked_content TEXT[\s\S]*metadata JSONB/);
    expect(sql()).toMatch(/category TEXT[\s\S]*hook_type TEXT[\s\S]*content_format TEXT/);
  });

  test('uses proof assets as a temporal facts ledger', () => {
    const migration = sql();
    for (const column of [
      'fact_key', 'fact_kind', 'fact_value', 'fact_unit', 'effective_from',
      'effective_to', 'fact_status', 'direction_policy', 'fact_change_reason',
      'supersedes_proof_asset_id', 'confirmed_by',
    ]) expect(migration).toContain(column);
    expect(migration).toMatch(/uq_proof_assets_active_fact/);
    expect(migration).toMatch(/prevent_confirmed_fact_delete/);
  });

  test('keeps fact suggestions unconfirmed until an atomic owner decision', () => {
    const migration = sql();
    expect(migration).toMatch(/suggestion_origin TEXT/);
    expect(migration).toMatch(/fact_payload JSONB/);
    expect(migration).toMatch(/source_content_item_variant_id UUID/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION confirm_fact_suggestion_atomic/);
    expect(migration).toMatch(/p_workspace_id UUID[\s\S]*FOR UPDATE/);
  });

  test('adds language siblings, writer defaults, and post QA context', () => {
    const migration = sql();
    expect(migration).toMatch(/ALTER TABLE content_items[\s\S]*language TEXT[\s\S]*generation_group_id UUID/);
    expect(migration).toMatch(/workspace_id, signal_ref, language/);
    expect(migration).toMatch(/ALTER TABLE workspace_writer_policies[\s\S]*output_languages TEXT\[\][\s\S]*product_mention_mode TEXT/);
    expect(migration).toMatch(/ALTER TABLE post_items[\s\S]*qa_context JSONB/);
  });

  test('does not grant direct mutation of sensitive records to clients', () => {
    const migration = sql();
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION confirm_fact_suggestion_atomic/);
    expect(migration).not.toMatch(/CREATE POLICY[^\n]*fact[^\n]*write/i);
    expect(migration).toMatch(/STOP-Gate: repository-only/);
  });
});
