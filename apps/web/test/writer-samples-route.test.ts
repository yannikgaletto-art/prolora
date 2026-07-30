import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

interface DbResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

const mocks = vi.hoisted(() => ({
  getWorkspaceId: vi.fn(),
  from: vi.fn(),
  results: [] as DbResult[],
  chains: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));

function queryChain(result: DbResult) {
  const promise = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'select',
    'eq',
    'order',
    'limit',
    'insert',
    'update',
    'delete',
    'single',
    'maybeSingle',
    'returns',
  ]) {
    chain[method] = vi.fn(() => Object.assign(promise, chain));
  }
  return Object.assign(promise, chain);
}

vi.mock('@/lib/api/auth-middleware', () => ({ getWorkspaceId: mocks.getWorkspaceId }));
vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({
      from: (table: string) => {
        mocks.from(table);
        const chain = queryChain(mocks.results.shift() ?? {});
        mocks.chains.push(chain);
        return chain;
      },
    }),
  };
});

import {
  GET as listSamples,
  POST as createSample,
} from '@/app/api/v1/writer/samples/route';
import {
  DELETE as deleteSample,
  PATCH as updateSample,
} from '@/app/api/v1/writer/samples/[id]/route';

const sampleRow = {
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: 'workspace-authenticated',
  kind: 'golden',
  origin: 'pasted',
  platform: null,
  content: 'A sufficiently long writing sample for deterministic analysis.',
  source_post_item_id: null,
  source_url: null,
  label: null,
  active: true,
  content_hash: 'a'.repeat(64),
  embedding: '[0.1,0.2]',
  created_at: '2026-07-30T12:00:00.000Z',
  updated_at: '2026-07-30T12:00:00.000Z',
};

function request(path: string, method = 'GET', body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
}

describe('Writer sample routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.length = 0;
    mocks.chains.length = 0;
    mocks.getWorkspaceId.mockResolvedValue('workspace-authenticated');
  });

  test('creates a normalized sample in the authenticated workspace without exposing embeddings', async () => {
    mocks.results.push(
      { count: 0 },
      { data: { ...sampleRow, content: sampleRow.content.replace('analysis.', 'analysis.\nNext.') } }
    );

    const response = await createSample(
      request('/api/v1/writer/samples', 'POST', {
        kind: 'golden',
        origin: 'pasted',
        content: `  ${sampleRow.content.replace('analysis.', 'analysis.\r\nNext.')}  `,
        workspace_id: 'workspace-attacker',
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.chains[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'workspace-authenticated',
        content: sampleRow.content.replace('analysis.', 'analysis.\nNext.'),
        content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    const payload = await response.json();
    expect(payload.sample).not.toHaveProperty('workspace_id');
    expect(payload.sample).not.toHaveProperty('embedding');
    expect(mocks.chains[1].select).not.toHaveBeenCalledWith(expect.stringContaining('embedding'));
  });

  test.each([
    ['too short', 'short'],
    ['too long', 'x'.repeat(20_001)],
  ])('rejects %s content before querying the database', async (_name, content) => {
    const response = await createSample(
      request('/api/v1/writer/samples', 'POST', {
        kind: 'golden',
        origin: 'pasted',
        content,
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  test('maps workspace duplicate hashes to 409', async () => {
    mocks.results.push(
      { count: 0 },
      { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
    );

    const response = await createSample(
      request('/api/v1/writer/samples', 'POST', {
        kind: 'golden',
        origin: 'pasted',
        content: sampleRow.content,
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'duplicate_sample' });
  });

  test('rejects a source post item outside the authenticated workspace', async () => {
    mocks.results.push({ data: null });

    const response = await createSample(
      request('/api/v1/writer/samples', 'POST', {
        kind: 'golden',
        origin: 'published',
        content: sampleRow.content,
        source_post_item_id: '22222222-2222-4222-8222-222222222222',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_source_post' });
    expect(mocks.from).toHaveBeenCalledWith('post_items');
    expect(mocks.chains[0].eq).toHaveBeenCalledWith(
      'post_groups.workspace_id',
      'workspace-authenticated'
    );
    expect(mocks.from).not.toHaveBeenCalledWith('content_samples');
  });

  test('rejects the 51st active sample before inserting it', async () => {
    mocks.results.push({ count: 50 });

    const response = await createSample(
      request('/api/v1/writer/samples', 'POST', {
        kind: 'avoid',
        origin: 'imported',
        content: sampleRow.content,
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'sample_limit_reached' });
    expect(mocks.chains).toHaveLength(1);
  });

  test('checks the active cap when reactivating an inactive workspace-owned sample', async () => {
    mocks.results.push(
      { data: { ...sampleRow, active: false } },
      { count: 50 }
    );

    const response = await updateSample(
      request(`/api/v1/writer/samples/${sampleRow.id}`, 'PATCH', { active: true }),
      { params: Promise.resolve({ id: sampleRow.id }) }
    );

    expect(response.status).toBe(409);
    expect(mocks.chains[0].eq).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-authenticated'
    );
    expect(mocks.chains).toHaveLength(2);
  });

  test('scopes deletion to workspace and id', async () => {
    mocks.results.push({ data: [{ id: sampleRow.id }] });

    const response = await deleteSample(
      request(`/api/v1/writer/samples/${sampleRow.id}`, 'DELETE'),
      { params: Promise.resolve({ id: sampleRow.id }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.chains[0].eq).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-authenticated'
    );
    expect(mocks.chains[0].eq).toHaveBeenCalledWith('id', sampleRow.id);
  });

  test('returns the exact migration_pending 503 for a missing table', async () => {
    mocks.results.push({
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.content_samples' in the schema cache",
      },
    });

    const response = await listSamples(request('/api/v1/writer/samples'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        'Content DNA storage is not set up yet — apply supabase/migrations/021_content_dna.sql.',
      code: 'migration_pending',
    });
  });
});
