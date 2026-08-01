import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('GDPR export for narrative QA data', () => {
  test('exports the new workspace data with explicit allowlists and no embeddings', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/gdpr/export-service.ts'), 'utf8');
    const executableSource = source.replace(/\/\/.*$/gm, '');
    for (const table of [
      'content_samples', 'content_dna_profiles', 'proof_assets',
      'proof_suggestions', 'content_items', 'workspace_writer_policies',
    ]) {
      expect(source).toContain(`${table}:`);
      expect(source).toMatch(new RegExp(`fetchTable\\(\\s*'${table}'`));
    }
    expect(source).toMatch(/post_items:[\s\S]*qa_context/);
    expect(executableSource).not.toMatch(/select\(['"]\*['"]\)/);
    expect(source).not.toMatch(/content_samples:[\s\S]{0,400}\bembedding\b/);
  });
});
