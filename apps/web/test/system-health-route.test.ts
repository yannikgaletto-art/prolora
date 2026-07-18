import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getWorkspaceId = vi.fn();
const getSystemStatus = vi.fn();

vi.mock('@/lib/api/auth-middleware', () => ({ getWorkspaceId }));
vi.mock('@/lib/system/doctor', () => ({ getSystemStatus }));

describe('GET /api/v1/system/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the authenticated workspace status', async () => {
    getWorkspaceId.mockResolvedValue('workspace-1');
    getSystemStatus.mockResolvedValue({ features: {}, plan: { name: 'agency' } });
    const { GET } = await import('../app/api/v1/system/health/route');

    const response = await GET(new NextRequest('http://localhost/api/v1/system/health'));

    expect(response.status).toBe(200);
    expect(getSystemStatus).toHaveBeenCalledWith('workspace-1');
    expect(await response.json()).toEqual({ features: {}, plan: { name: 'agency' } });
  });
});
