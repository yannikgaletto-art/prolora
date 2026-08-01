import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), requireOwner: vi.fn(), importBundle: vi.fn(), loadFiles: vi.fn(),
}));
vi.mock('@/lib/api/auth-middleware', () => ({ authenticate: mocks.authenticate }));
vi.mock('@/lib/writer/policy', () => ({ requireWriterOwnerOrAdmin: mocks.requireOwner }));
vi.mock('@/lib/writer/bundle-import', () => ({
  importGoldenSampleBundle: mocks.importBundle,
  loadCuratedGoldenSampleFiles: mocks.loadFiles,
}));

import { POST } from '@/app/api/v1/writer/samples/import/route';

describe('Golden Sample import route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ workspaceId: 'workspace-1', method: 'session', userId: 'owner-1' });
    mocks.requireOwner.mockResolvedValue({ role: 'owner', userId: 'owner-1' });
    mocks.loadFiles.mockResolvedValue([{ sourceFile: 'one.md', markdown: '# bundle' }]);
    mocks.importBundle.mockResolvedValue({ imported: 12, samples: [] });
  });

  test('requires an owner/admin session and imports the curated bundle idempotently', async () => {
    const response = await POST(new NextRequest('http://localhost/api/v1/writer/samples/import', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(mocks.requireOwner).toHaveBeenCalled();
    expect(mocks.importBundle).toHaveBeenCalledWith('workspace-1', expect.any(Array), '2026-08-01');
    await expect(response.json()).resolves.toMatchObject({ imported: 12, idempotent: true });
  });
});
