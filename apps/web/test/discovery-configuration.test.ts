import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api/http';
import type { DiscoveryProvider } from '../lib/integrations/registry';

// Discovery readiness stopped being "is Reddit connected" once Mastodon and
// Hacker News joined: those need no credentials, so a fresh workspace is ready
// by default and only an explicit selection can come up empty. The provider
// layer is stubbed here; its own availability rules live in its tests.
const listDiscoveryProviderStatuses = vi.fn<(workspaceId: string) => Promise<unknown[]>>();
const getDiscoveryProvider = vi.fn<() => Promise<DiscoveryProvider>>();

vi.mock('../lib/discovery/providers', () => ({
  listDiscoveryProviderStatuses: (workspaceId: string) =>
    listDiscoveryProviderStatuses(workspaceId),
  getDiscoveryProvider: () => getDiscoveryProvider(),
  toDiscoveryProvider: (platform: string) => platform,
}));

vi.mock('../lib/discovery/auto-context', () => ({
  getWorkspaceContext: async () => ({ suggested_keywords: ['saas', 'pricing', 'dach'] }),
}));

const evaluations: unknown[] = [];
vi.mock('../lib/ai/client', () => ({
  AI_MODEL: 'test-model',
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', input: { evaluations } }] }),
    },
  }),
}));

// Supabase stub that can simulate migration 015 not being applied: any query
// touching `community_external_id` answers with Postgres' undefined-column code.
let externalColumnMissing = false;
const inserts: Array<Record<string, unknown>> = [];

function makeDb() {
  return {
    from: () => {
      const filters: string[] = [];
      const builder = {
        select: () => builder,
        eq: (column: string) => {
          filters.push(column);
          return builder;
        },
        maybeSingle: async () =>
          externalColumnMissing && filters.includes('community_external_id')
            ? { data: null, error: { code: '42703', message: 'column does not exist' } }
            : { data: null, error: null },
        insert: (payload: Record<string, unknown>) => {
          inserts.push(payload);
          const failed =
            externalColumnMissing && Object.hasOwn(payload, 'community_external_id');
          return {
            then: (resolve: (value: unknown) => unknown) =>
              resolve(
                failed
                  ? { error: { code: '42703', message: 'column does not exist' } }
                  : { error: null }
              ),
          };
        },
        update: () => ({ eq: () => ({ then: (r: (v: unknown) => unknown) => r({ error: null }) }) }),
      };
      return builder;
    },
  };
}

vi.mock('../lib/db', async () => {
  const actual = await vi.importActual<typeof import('../lib/db')>('../lib/db');
  return { ...actual, getServiceDb: () => makeDb() };
});

const { assertDiscoveryConfiguration, mapCommunities } = await import(
  '../lib/discovery/community-mapper'
);

function status(provider: string, available: boolean) {
  return { provider, label: provider, credentialKind: 'none', available, reason: null, deepLink: null };
}

beforeEach(() => {
  listDiscoveryProviderStatuses.mockReset();
  getDiscoveryProvider.mockReset();
  externalColumnMissing = false;
  inserts.length = 0;
  evaluations.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('assertDiscoveryConfiguration', () => {
  it('passes for a workspace with no credentials at all, thanks to the public-API providers', async () => {
    listDiscoveryProviderStatuses.mockResolvedValue([
      status('mastodon', true),
      status('hackernews', true),
      status('reddit', false),
      status('bluesky', false),
    ]);

    await expect(assertDiscoveryConfiguration('ws-1')).resolves.toBeUndefined();
  });

  it('returns a structured setup error when nothing is reachable', async () => {
    listDiscoveryProviderStatuses.mockResolvedValue([
      status('mastodon', false),
      status('reddit', false),
    ]);

    await expect(assertDiscoveryConfiguration('ws-1')).rejects.toBeInstanceOf(ApiError);
    await expect(assertDiscoveryConfiguration('ws-1')).rejects.toMatchObject({
      status: 503,
      code: 'discovery_not_configured',
    });
  });

  it('fails only for the explicitly selected platforms', async () => {
    listDiscoveryProviderStatuses.mockResolvedValue([
      status('mastodon', true),
      status('reddit', false),
    ]);

    // Mastodon is available, but the caller asked for Reddit only.
    await expect(assertDiscoveryConfiguration('ws-1', ['reddit'])).rejects.toMatchObject({
      status: 503,
      code: 'discovery_not_configured',
    });
    await expect(assertDiscoveryConfiguration('ws-1', ['mastodon'])).resolves.toBeUndefined();
  });

  it('scopes the readiness check to the calling workspace', async () => {
    listDiscoveryProviderStatuses.mockResolvedValue([status('mastodon', true)]);
    await assertDiscoveryConfiguration('ws-42');
    expect(listDiscoveryProviderStatuses).toHaveBeenCalledWith('ws-42');
  });
});

// A provider without a rules API must not lose its communities: `null` means
// "rules unavailable", so only the rules part of the evaluation is skipped.
function ruleless(): DiscoveryProvider {
  return {
    id: 'mastodon',
    capabilities: { findCommunities: true, readRules: false, scanThreads: true },
    searchCommunities: async () => [
      {
        externalId: 'saas',
        name: '#saas',
        url: 'https://mastodon.social/tags/saas',
        description: 'Fediverse hashtag',
        memberCount: 42,
        activeCount: 12,
        language: 'de',
        nsfw: false,
        isTopicQuery: false,
      },
    ],
    getCommunityRules: async () => null,
    searchThreads: async () => [],
    getHotThreads: async () => [],
    degradations: [],
  };
}

describe('mapCommunities across providers', () => {
  beforeEach(() => {
    listDiscoveryProviderStatuses.mockResolvedValue([status('mastodon', true)]);
    getDiscoveryProvider.mockResolvedValue(ruleless());
    evaluations.push({
      index: 0,
      relevance_score: 0.9,
      language: 'de',
      rules_summary: 'made up',
      self_promo_policy: 'strict',
      recommended_approach: 'be useful',
      top_recurring_questions: [],
    });
  });

  it('keeps a community whose provider has no rules API', async () => {
    const communities = await mapCommunities({
      workspaceId: 'ws-1',
      productDescription: 'a publishing API',
      targetAudience: 'solo founders',
    });

    expect(communities).toHaveLength(1);
    expect(communities[0]).toMatchObject({ platform: 'mastodon', name: '#saas' });
    // The model's invented rules summary is replaced by the honest one.
    expect(communities[0]?.rules_summary).toMatch(/not available/i);
  });

  it('writes community_external_id as the cross-provider dedupe key', async () => {
    await mapCommunities({
      workspaceId: 'ws-1',
      productDescription: 'a publishing API',
      targetAudience: 'solo founders',
    });

    const community = inserts.find((row) => row.platform === 'mastodon');
    expect(community?.community_external_id).toBe('saas');
  });

  // Deploy-Order-Guard: the column only exists once migration 015 is applied.
  it('degrades to the pre-015 shape instead of 500-ing when the column is missing', async () => {
    externalColumnMissing = true;

    const communities = await mapCommunities({
      workspaceId: 'ws-1',
      productDescription: 'a publishing API',
      targetAudience: 'solo founders',
    });

    expect(communities).toHaveLength(1);
    const communityWrites = inserts.filter((row) => row.platform === 'mastodon');
    expect(communityWrites).toHaveLength(2);
    expect(communityWrites[0]).toHaveProperty('community_external_id');
    expect(communityWrites[1]).not.toHaveProperty('community_external_id');
  });
});
