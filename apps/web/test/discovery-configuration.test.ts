import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api/http';

// Reddit readiness moved from "is the env set" to "does this workspace have
// credentials" (migration 014), so the check is async and workspace-scoped.
// The credential layer is stubbed here; its own resolution order is covered by
// reddit-credentials.test.ts.
const isRedditConfigured = vi.fn<(workspaceId: string) => Promise<boolean>>();

vi.mock('../lib/integrations/reddit-credentials', () => ({
  isRedditConfigured: (workspaceId: string) => isRedditConfigured(workspaceId),
  getRedditClientForWorkspace: vi.fn(),
}));

const { assertDiscoveryConfiguration } = await import('../lib/discovery/community-mapper');

beforeEach(() => {
  isRedditConfigured.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('assertDiscoveryConfiguration', () => {
  it('returns a structured setup error when the workspace has no Reddit access', async () => {
    isRedditConfigured.mockResolvedValue(false);

    await expect(assertDiscoveryConfiguration('ws-1')).rejects.toBeInstanceOf(ApiError);
    await expect(assertDiscoveryConfiguration('ws-1')).rejects.toMatchObject({
      status: 503,
      code: 'discovery_not_configured',
    });
  });

  it('allows discovery when the workspace has Reddit access', async () => {
    isRedditConfigured.mockResolvedValue(true);
    await expect(assertDiscoveryConfiguration('ws-1')).resolves.toBeUndefined();
  });

  it('scopes the readiness check to the calling workspace', async () => {
    isRedditConfigured.mockResolvedValue(true);
    await assertDiscoveryConfiguration('ws-42');
    expect(isRedditConfigured).toHaveBeenCalledWith('ws-42');
  });
});
