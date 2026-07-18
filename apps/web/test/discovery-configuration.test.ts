import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api/http';
import { assertDiscoveryConfiguration } from '../lib/discovery/community-mapper';

const originalId = process.env.REDDIT_CLIENT_ID;
const originalSecret = process.env.REDDIT_CLIENT_SECRET;

afterEach(() => {
  process.env.REDDIT_CLIENT_ID = originalId;
  process.env.REDDIT_CLIENT_SECRET = originalSecret;
});

describe('assertDiscoveryConfiguration', () => {
  it('returns a structured setup error when Reddit credentials are absent', () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;

    try {
      assertDiscoveryConfiguration();
      throw new Error('expected discovery setup error');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503, code: 'discovery_not_configured' });
    }
  });

  it('allows discovery when both Reddit credentials exist', () => {
    process.env.REDDIT_CLIENT_ID = 'client-id';
    process.env.REDDIT_CLIENT_SECRET = 'client-secret';
    expect(() => assertDiscoveryConfiguration()).not.toThrow();
  });
});
