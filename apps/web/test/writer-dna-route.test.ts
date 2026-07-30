import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

interface DbResult {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

const mocks = vi.hoisted(() => ({
  getWorkspaceId: vi.fn(),
  authenticate: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  results: [] as DbResult[],
  chains: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));

function queryChain(result: DbResult) {
  const promise = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  });
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    'select',
    'eq',
    'order',
    'limit',
    'insert',
    'update',
    'single',
    'maybeSingle',
    'returns',
  ]) {
    chain[method] = vi.fn(() => Object.assign(promise, chain));
  }
  return Object.assign(promise, chain);
}

vi.mock('@/lib/api/auth-middleware', () => ({
  getWorkspaceId: mocks.getWorkspaceId,
  authenticate: mocks.authenticate,
}));
vi.mock('@/lib/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...original,
    getServiceDb: () => ({
      rpc: mocks.rpc,
      from: (table: string) => {
        mocks.from(table);
        const chain = queryChain(mocks.results.shift() ?? {});
        mocks.chains.push(chain);
        return chain;
      },
    }),
  };
});

import { GET } from '@/app/api/v1/writer/dna/route';
import { POST } from '@/app/api/v1/writer/dna/rebuild/route';

const activeProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  workspace_id: 'workspace-authenticated',
  version: 1,
  status: 'active',
  sample_set_hash: 'a'.repeat(64),
  schema_version: 'content-dna-v1',
  profile: {
    medianSentenceLength: 8,
    medianParagraphLength: 20,
    firstPersonRate: 0.1,
    questionRate: 0,
    exclamationRate: 0,
    listUsage: 0,
    ctaPresence: 0,
    commonOpeningShapes: ['statement'],
    preferredWhitespaceDensity: 0.2,
  },
  confidence: { overall: 'low', features: {} },
  locked_rules: [
    { key: 'sentence_length', instruction: 'Keep sentences concise.', locked: true },
  ],
  prompt_rules: [
    { key: 'sentence_length', instruction: 'Keep sentences concise.', locked: true },
  ],
  sample_count: 2,
  model: 'deterministic-v1',
  prompt_version: 'writer-dna-v1',
  created_at: '2026-07-30T12:00:00.000Z',
};

const samples = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: 'workspace-authenticated',
    kind: 'golden',
    origin: 'pasted',
    platform: null,
    content: 'I write a sufficiently long sample.\\n\\nTry this clear next step.',
    source_post_item_id: null,
    source_url: null,
    label: null,
    active: true,
    content_hash: 'b'.repeat(64),
    created_at: '2026-07-30T12:00:00.000Z',
    updated_at: '2026-07-30T12:00:00.000Z',
  },
];

function request(path: string, method = 'GET'): NextRequest {
  return new NextRequest(`http://localhost${path}`, { method });
}

describe('Writer DNA routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.length = 0;
    mocks.chains.length = 0;
    mocks.getWorkspaceId.mockResolvedValue('workspace-authenticated');
    mocks.authenticate.mockResolvedValue({
      workspaceId: 'workspace-authenticated',
      method: 'session',
      userId: 'admin-1',
      workspaceRole: 'admin',
    });
    mocks.rpc.mockReset();
  });

  test('returns an honest low-confidence fallback before the first profile exists', async () => {
    mocks.results.push(
      { data: null },
      { data: samples }
    );

    const response = await GET(request('/api/v1/writer/dna'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      dna_profile: null,
      fallback: {
        sampleCount: 1,
        confidence: { overall: 'low' },
      },
    });
    expect(mocks.chains[0].eq).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-authenticated'
    );
  });

  test('creates the next immutable version and preserves locked rules', async () => {
    const buildingProfile = {
      ...activeProfile,
      id: '33333333-3333-4333-8333-333333333333',
      version: 2,
      status: 'building',
      sample_set_hash: 'c'.repeat(64),
    };
    const activatedProfile = { ...buildingProfile, status: 'active' };
    mocks.results.push({ data: samples }, { data: activeProfile });
    mocks.rpc.mockResolvedValue({ data: [activatedProfile], error: null });

    const response = await POST(request('/api/v1/writer/dna/rebuild', 'POST'));

    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'rebuild_content_dna_atomic',
      expect.objectContaining({
        p_workspace_id: 'workspace-authenticated',
        p_locked_rules: activeProfile.locked_rules,
        p_prompt_rules: expect.arrayContaining(activeProfile.locked_rules),
        p_sample_set_members: ['golden:' + 'b'.repeat(64)],
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      dna_profile: {
        version: 2,
        status: 'active',
        prompt_rules: activeProfile.prompt_rules,
      },
    });
  });

  test('reports a sample-set race without leaving application-side lifecycle writes', async () => {
    mocks.results.push({ data: samples }, { data: activeProfile });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'content_sample_set_changed' },
    });

    const response = await POST(request('/api/v1/writer/dna/rebuild', 'POST'));

    expect(response.status).toBe(409);
    expect(mocks.chains).toHaveLength(2);
  });

  test('returns the exact migration_pending 503 during rebuild', async () => {
    mocks.results.push({ data: samples }, { data: activeProfile });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.rebuild_content_dna_atomic',
      },
    });

    const response = await POST(request('/api/v1/writer/dna/rebuild', 'POST'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error:
        'Content DNA storage is not set up yet — apply supabase/migrations/021_content_dna.sql.',
      code: 'migration_pending',
    });
  });

  test.each([
    { method: 'session', workspaceRole: 'member', userId: 'member-1' },
    { method: 'session', workspaceRole: 'viewer', userId: 'viewer-1' },
    { method: 'api_key', apiKeyId: 'key-1' },
  ])('rejects DNA rebuild by $method/$workspaceRole', async (auth) => {
    mocks.authenticate.mockResolvedValue({
      workspaceId: 'workspace-authenticated',
      ...auth,
    });

    const response = await POST(request('/api/v1/writer/dna/rebuild', 'POST'));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
