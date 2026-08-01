import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  requireOwner: vi.fn(),
  confirmFact: vi.fn(),
  confirmFactSuggestion: vi.fn(),
  acceptProofSuggestion: vi.fn(),
  rejectProofSuggestion: vi.fn(),
  listFactsAt: vi.fn(),
  listProofAssets: vi.fn(),
  createProofAsset: vi.fn(),
}));

vi.mock('@/lib/api/auth-middleware', () => ({
  authenticate: mocks.authenticate,
  getWorkspaceId: vi.fn(),
}));
vi.mock('@/lib/writer/policy', () => ({ requireWriterOwnerOrAdmin: mocks.requireOwner }));
vi.mock('@/lib/product/facts', () => ({
  confirmFact: mocks.confirmFact,
  confirmFactSuggestion: mocks.confirmFactSuggestion,
  listFactsAt: mocks.listFactsAt,
}));
vi.mock('@/lib/feedback/proof-extraction', () => ({
  acceptProofSuggestion: mocks.acceptProofSuggestion,
  rejectProofSuggestion: mocks.rejectProofSuggestion,
}));
vi.mock('@/lib/product/profile', () => ({
  listProofAssets: mocks.listProofAssets,
  createProofAsset: mocks.createProofAsset,
}));

import { GET, POST } from '@/app/api/v1/product/proof-assets/route';
import { POST as decideSuggestion } from '@/app/api/v1/product/proof-suggestions/[id]/route';

const request = (method: string, body?: unknown) => new NextRequest(
  'http://localhost/api/v1/product/proof-assets?as_of=2026-08-01T00:00:00.000Z',
  {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }
);

describe('Facts routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      workspaceId: 'workspace-1', method: 'session', userId: 'owner-1',
    });
    mocks.requireOwner.mockResolvedValue({ role: 'owner', userId: 'owner-1' });
    mocks.listProofAssets.mockResolvedValue([]);
    mocks.listFactsAt.mockResolvedValue([]);
  });

  test('requires owner/admin confirmation for a structured fact', async () => {
    mocks.confirmFact.mockResolvedValue({ id: 'fact-1', factKey: 'pathly.users.active' });
    const response = await POST(request('POST', {
      type: 'metric',
      content: 'Active users on August 1',
      fact_key: 'pathly.users.active',
      fact_kind: 'metric',
      fact_value: { number: 100 },
      fact_unit: 'users',
      effective_from: '2026-08-01T00:00:00.000Z',
      direction_policy: 'warn_on_decrease',
    }));

    expect(response.status).toBe(201);
    expect(mocks.requireOwner).toHaveBeenCalledWith(expect.objectContaining({ method: 'session' }));
    expect(mocks.confirmFact).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ factKey: 'pathly.users.active', value: { number: 100 } }),
      'owner-1'
    );
  });

  test('returns facts resolved at the requested timestamp beside ordinary proofs', async () => {
    mocks.listFactsAt.mockResolvedValue([{ id: 'fact-1', factKey: 'pathly.users.active' }]);
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(mocks.listFactsAt).toHaveBeenCalledWith('workspace-1', '2026-08-01T00:00:00.000Z');
    await expect(response.json()).resolves.toMatchObject({ facts: [{ id: 'fact-1' }] });
  });

  test('confirms a structured suggestion atomically as owner/admin', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mocks.confirmFactSuggestion.mockResolvedValue({ id: 'fact-1', factKey: 'pathly.users.active' });
    const response = await decideSuggestion(
      request('POST', { decision: 'confirm_fact' }),
      { params: Promise.resolve({ id }) }
    );
    expect(response.status).toBe(201);
    expect(mocks.requireOwner).toHaveBeenCalled();
    expect(mocks.confirmFactSuggestion).toHaveBeenCalledWith('workspace-1', id, 'owner-1');
  });
});
