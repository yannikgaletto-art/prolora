import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HackerNewsDiscoveryProvider } from '../lib/discovery/providers/hackernews-provider';
import { getProviderDescriptor } from '../lib/integrations/registry';

// Hacker News has no communities. What this provider stores is a saved topic
// query, and both the capability flags and the candidate shape have to say so —
// otherwise the UI would show membership numbers and posting rules that do not
// exist. The second half pins the 429 behaviour: back off, then hand back the
// part of the scan that already succeeded.

const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>();
const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});

function hit(objectID: string, title: string, ageSeconds = 3600) {
  return {
    objectID,
    title,
    author: 'pg',
    points: 42,
    num_comments: 7,
    story_text: `${title} body`,
    created_at_i: Math.floor(Date.now() / 1000) - ageSeconds,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  sleep.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('topics as pseudo-communities', () => {
  it('declares that it cannot find communities', () => {
    const provider = new HackerNewsDiscoveryProvider(sleep);
    expect(provider.capabilities).toEqual({
      findCommunities: false,
      readRules: false,
      scanThreads: true,
    });
    // The UI copy is derived from the same flags, so it stays honest too.
    expect(getProviderDescriptor('hackernews').capabilities).toEqual(provider.capabilities);
  });

  it('maps one topic to one saved-search candidate', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hits: [hit('1', 'Show HN: AI agents'), hit('2', 'Ask HN: agents')], nbHits: 231 })
    );

    const provider = new HackerNewsDiscoveryProvider(sleep);
    const candidates = await provider.searchCommunities(['AI Agents'], 5);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: 'ai agents',
      name: 'HN topic: "ai agents"',
      isTopicQuery: true,
      memberCount: 231,
      activeCount: 2,
      language: 'en',
    });
    expect(candidates[0]?.description).toMatch(/no communities/i);
    expect(candidates[0]?.url).toContain('hn.algolia.com');
  });

  it('deduplicates topics that normalise to the same query', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hits: [hit('1', 'x')], nbHits: 1 }));
    const provider = new HackerNewsDiscoveryProvider(sleep);
    const candidates = await provider.searchCommunities(['AI  agents', 'ai agents'], 5);
    expect(candidates).toHaveLength(1);
  });

  it('drops topics with no stories at all rather than inventing a community', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hits: [], nbHits: 0 }));
    const provider = new HackerNewsDiscoveryProvider(sleep);
    await expect(provider.searchCommunities(['nothing here'], 5)).resolves.toEqual([]);
  });

  it('maps stories to threads with HN item URLs', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hits: [hit('4242', 'Launch HN: Prolora')] }));
    const provider = new HackerNewsDiscoveryProvider(sleep);
    const threads = await provider.searchThreads('prolora', 'prolora OR launch', { time: 'day' });

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      externalId: 'hn_4242',
      url: 'https://news.ycombinator.com/item?id=4242',
      communityName: 'HN topic: "prolora"',
      score: 42,
      replies: 7,
    });
  });

  it('applies the local keyword re-check the radar relies on', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ hits: [hit('1', 'Completely unrelated'), hit('2', 'About prolora')] })
    );
    const provider = new HackerNewsDiscoveryProvider(sleep);
    const threads = await provider.searchThreads('prolora', 'prolora', { time: 'day' });
    expect(threads.map((thread) => thread.externalId)).toEqual(['hn_2']);
  });
});

describe('429 mid-scan backs off and returns a partial result', () => {
  it('retries with backoff before giving up on a topic', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));

    const provider = new HackerNewsDiscoveryProvider(sleep);
    await expect(provider.searchCommunities(['ai agents'], 5)).resolves.toEqual([]);

    // Two retries, then give up — and the waits grow.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([400, 800]);
    expect(provider.degradations[0]).toMatchObject({
      source: 'ai agents',
      reason: expect.stringContaining('429'),
    });
  });

  it('keeps the topics that already succeeded when a later one is rate limited', async () => {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ hits: [hit('1', 'first topic story')], nbHits: 5 })
        : jsonResponse({}, 429);
    });

    const provider = new HackerNewsDiscoveryProvider(sleep);
    const candidates = await provider.searchCommunities(['first', 'second'], 5);

    expect(candidates.map((candidate) => candidate.externalId)).toEqual(['first']);
    expect(provider.degradations.map((entry) => entry.source)).toEqual(['second']);
  });

  it('never throws when the API is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const provider = new HackerNewsDiscoveryProvider(sleep);
    await expect(provider.getHotThreads('ai agents', 5)).resolves.toEqual([]);
    expect(provider.degradations).toHaveLength(1);
  });
});
