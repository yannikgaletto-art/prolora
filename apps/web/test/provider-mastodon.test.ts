import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MastodonDiscoveryProvider, stripHtml } from '../lib/discovery/providers/mastodon-provider';

// The fediverse has no uptime guarantee: a discovery run that fans out to six
// instances must survive any subset of them being down. These tests pin that
// down — one live instance is enough to return results, and the dead one shows
// up as a degradation rather than as an exception.

const GOOD = 'good.example';
const DEAD = 'dead.example';

function status(id: string, content: string, account: string, favourites = 1) {
  return {
    id,
    uri: `https://${GOOD}/users/${account}/statuses/${id}`,
    url: `https://${GOOD}/@${account}/${id}`,
    created_at: new Date().toISOString(),
    content: `<p>${content}</p>`,
    language: 'de',
    favourites_count: favourites,
    reblogs_count: 0,
    replies_count: 2,
    account: { acct: account },
  };
}

const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>();

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('instance outage degrades to a partial result', () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes(DEAD)) throw new Error('The operation was aborted due to timeout');
      if (url.includes('/api/v1/trends/tags')) return jsonResponse([]);
      return jsonResponse([
        status('1', 'Wir bauen ein SaaS für DACH', 'anna@good.example'),
        status('2', 'SaaS Pricing ist schwer', 'bert@good.example'),
        status('3', 'noch mehr SaaS', 'anna@good.example'),
      ]);
    });
  });

  it('returns what the reachable instances answered', async () => {
    const provider = new MastodonDiscoveryProvider([GOOD, DEAD]);
    const candidates = await provider.searchCommunities(['saas'], 10);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: 'saas',
      name: '#saas',
      isTopicQuery: false,
      // Two distinct accounts posted the three statuses.
      memberCount: 2,
      language: 'de',
    });
  });

  it('records the dead instance as a degradation instead of throwing', async () => {
    const provider = new MastodonDiscoveryProvider([GOOD, DEAD]);
    await provider.searchCommunities(['saas'], 10);

    expect(provider.degradations.map((entry) => entry.source)).toEqual([DEAD]);
    expect(provider.degradations[0]?.reason).toMatch(/timeout/i);
  });

  it('keeps scanning threads with one instance down', async () => {
    const provider = new MastodonDiscoveryProvider([GOOD, DEAD]);
    const threads = await provider.searchThreads('saas', 'saas OR pricing', { time: 'week' });

    expect(threads.length).toBeGreaterThan(0);
    expect(threads[0]?.communityName).toBe('#saas');
    expect(provider.degradations).toHaveLength(1);
  });

  it('survives every instance being down — empty result, no throw', async () => {
    const provider = new MastodonDiscoveryProvider([DEAD]);
    await expect(provider.searchCommunities(['saas'], 10)).resolves.toEqual([]);
    expect(provider.degradations).toHaveLength(1);
  });

  it('treats an HTTP error the same way as an unreachable host', async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input).includes(DEAD) ? jsonResponse({}, { status: 503 }) : jsonResponse([])
    );
    const provider = new MastodonDiscoveryProvider([GOOD, DEAD]);
    await provider.searchCommunities(['saas'], 10);
    expect(provider.degradations[0]).toMatchObject({ source: DEAD, reason: 'HTTP 503' });
  });
});

describe('federated duplicates', () => {
  it('counts a post relayed to several instances once', async () => {
    const shared = status('1', 'geteilter Post', 'anna@good.example');
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/api/v1/trends/tags')) return jsonResponse([]);
      return jsonResponse([shared]);
    });

    const provider = new MastodonDiscoveryProvider([GOOD, 'mirror.example']);
    const threads = await provider.getHotThreads('saas', 10);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.externalId).toBe(shared.uri);
  });
});

describe('stripHtml', () => {
  it('turns instance HTML into the plain text the LLM and DB expect', () => {
    expect(stripHtml('<p>Hallo<br/>Welt</p><p>Zweiter &amp; Absatz</p>')).toBe(
      'Hallo\nWelt\n\nZweiter & Absatz'
    );
  });
});
