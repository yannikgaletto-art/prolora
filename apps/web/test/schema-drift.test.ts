// Regression test for the 2026-07-22 production incident: /product 500ed
// because migrations 012/013 were not applied yet (PGRST205 / 42703). Read
// paths must degrade to empty results; write paths must fail with a clear
// 503 migration_pending instead of an opaque 500.
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/http';

const missingTableError = {
  code: 'PGRST205',
  message: "Could not find the table 'public.proof_assets' in the schema cache",
};

function missingTableChain(): Record<string, unknown> {
  const result = Promise.resolve({ data: null, error: missingTableError });
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'or', 'order', 'limit', 'insert', 'upsert', 'delete', 'single', 'returns']) {
    chain[method] = () => Object.assign(result, chain);
  }
  return Object.assign(result, chain);
}

vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({ from: () => missingTableChain() }),
  };
});

import { isMissingSchemaError } from '@/lib/db';
import { createProofAsset, listProofAssets } from '@/lib/product/profile';
import { listContentReferences } from '@/lib/content/references';

describe('missing-schema classifier', () => {
  test('matches Postgres and PostgREST missing-relation codes', () => {
    for (const code of ['42P01', '42703', 'PGRST205', 'PGRST204']) {
      expect(isMissingSchemaError(code), code).toBe(true);
    }
    expect(isMissingSchemaError('23505')).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
  });
});

describe('graceful degradation before migrations 012/013', () => {
  test('proof asset reads return empty instead of crashing the page', async () => {
    await expect(listProofAssets('ws-1')).resolves.toEqual([]);
  });

  test('reference reads return empty instead of crashing the Start tab', async () => {
    await expect(listContentReferences('ws-1')).resolves.toEqual([]);
  });

  test('proof asset writes surface a clear migration_pending error', async () => {
    const attempt = createProofAsset('ws-1', { type: 'metric', content: 'Testwert 123' });
    await expect(attempt).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.code === 'migration_pending'
    );
  });
});
