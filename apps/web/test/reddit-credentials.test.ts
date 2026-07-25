import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A real 32-byte hex key so encrypt/decrypt run for real rather than mocked —
// the round-trip is the part worth trusting.
process.env.TOKEN_ENCRYPTION_KEY_V2 = '0'.repeat(64);

interface StubResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let selectResult: StubResult = { data: null, error: null };
let upsertResult: { error: { code?: string; message: string } | null } = { error: null };
const upsertSpy = vi.fn();

// Minimal Supabase query-builder stub: every chained filter returns `this`,
// and the promise-shaped terminals resolve to the configured result.
function makeDb() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => selectResult),
    upsert: vi.fn(async (payload: unknown, options: unknown) => {
      upsertSpy(payload, options);
      return upsertResult;
    }),
    then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
  };
  return { from: vi.fn(() => builder) };
}

vi.mock('../lib/db', async () => {
  const actual = await vi.importActual<typeof import('../lib/db')>('../lib/db');
  return { ...actual, getServiceDb: () => makeDb() };
});

const requestRedditToken = vi.fn<() => Promise<{ accessToken: string; expiresIn: number }>>();
vi.mock('../lib/discovery/reddit-client', () => ({
  RedditClient: class {
    constructor(public readonly credentials: unknown) {}
  },
  requestRedditToken: () => requestRedditToken(),
  forgetRedditToken: vi.fn(),
}));

const {
  resolveRedditCredentials,
  getRedditIntegrationStatus,
  saveRedditCredentials,
  verifyRedditCredentials,
} = await import('../lib/integrations/reddit-credentials');
const { encrypt } = await import('../lib/auth/encryption');

beforeEach(() => {
  selectResult = { data: null, error: null };
  upsertResult = { error: null };
  upsertSpy.mockReset();
  requestRedditToken.mockReset();
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveRedditCredentials', () => {
  it('prefers the workspace row over the process environment', async () => {
    process.env.REDDIT_CLIENT_ID = 'env-id';
    process.env.REDDIT_CLIENT_SECRET = 'env-secret';
    selectResult = {
      data: { credentials: encrypt(JSON.stringify({ clientId: 'ws-id', clientSecret: 'ws-secret' })) },
      error: null,
    };

    await expect(resolveRedditCredentials('ws-1')).resolves.toEqual({
      credentials: { clientId: 'ws-id', clientSecret: 'ws-secret' },
      source: 'workspace',
    });
  });

  it('falls back to the environment when no workspace row exists', async () => {
    process.env.REDDIT_CLIENT_ID = 'env-id';
    process.env.REDDIT_CLIENT_SECRET = 'env-secret';

    await expect(resolveRedditCredentials('ws-1')).resolves.toEqual({
      credentials: { clientId: 'env-id', clientSecret: 'env-secret' },
      source: 'environment',
    });
  });

  it('returns null when neither source has credentials', async () => {
    await expect(resolveRedditCredentials('ws-1')).resolves.toBeNull();
  });

  // Deploy-order guard: with migration 014 unapplied the table is absent, and
  // an env-configured deployment must keep working instead of 500-ing.
  it('degrades to the environment when the integrations table is missing', async () => {
    process.env.REDDIT_CLIENT_ID = 'env-id';
    process.env.REDDIT_CLIENT_SECRET = 'env-secret';
    selectResult = { data: null, error: { code: 'PGRST205', message: 'relation does not exist' } };

    await expect(resolveRedditCredentials('ws-1')).resolves.toMatchObject({
      source: 'environment',
    });
  });

  it('falls back rather than throwing when stored ciphertext cannot be decrypted', async () => {
    process.env.REDDIT_CLIENT_ID = 'env-id';
    process.env.REDDIT_CLIENT_SECRET = 'env-secret';
    selectResult = { data: { credentials: 'v2:zz:zz:zz' }, error: null };

    await expect(resolveRedditCredentials('ws-1')).resolves.toMatchObject({
      source: 'environment',
    });
  });
});

describe('getRedditIntegrationStatus', () => {
  it('never exposes the secret or its ciphertext', async () => {
    selectResult = {
      data: {
        credentials: encrypt(JSON.stringify({ clientId: 'ws-id', clientSecret: 'top-secret' })),
        client_id_hint: 'ws-id',
        verified_at: '2026-07-25T10:00:00.000Z',
        last_error: null,
      },
      error: null,
    };

    const status = await getRedditIntegrationStatus('ws-1');
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain('top-secret');
    expect(serialised).not.toContain('v2:');
    expect(status).toMatchObject({ connected: true, source: 'workspace', clientIdHint: 'ws-id' });
  });

  it('reports disconnected when there is neither a row nor env keys', async () => {
    await expect(getRedditIntegrationStatus('ws-1')).resolves.toMatchObject({
      connected: false,
      source: null,
    });
  });
});

describe('saveRedditCredentials', () => {
  it('refuses to persist a pair Reddit rejects', async () => {
    requestRedditToken.mockRejectedValue(new Error('Reddit rejected these credentials (401).'));

    const result = await saveRedditCredentials('ws-1', {
      clientId: 'bad',
      clientSecret: 'wrong',
    });

    expect(result).toMatchObject({ ok: false });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('stores the secret encrypted, never in plaintext', async () => {
    requestRedditToken.mockResolvedValue({ accessToken: 'token', expiresIn: 86400 });
    selectResult = {
      data: { client_id_hint: 'good-id', verified_at: '2026-07-25T10:00:00.000Z', last_error: null },
      error: null,
    };

    const result = await saveRedditCredentials('ws-1', {
      clientId: 'good-id',
      clientSecret: 'super-secret',
    });

    expect(result.ok).toBe(true);
    const [payload] = upsertSpy.mock.calls[0] as [Record<string, string>];
    expect(payload.credentials).not.toContain('super-secret');
    expect(payload.credentials).toMatch(/^v2:/);
    expect(payload.client_id_hint).toBe('good-id');
  });
});

describe('verifyRedditCredentials', () => {
  it('returns the failure reason instead of throwing', async () => {
    requestRedditToken.mockRejectedValue(new Error('Reddit rate limit hit while verifying.'));
    await expect(
      verifyRedditCredentials({ clientId: 'a', clientSecret: 'b' })
    ).resolves.toEqual({ ok: false, reason: 'Reddit rate limit hit while verifying.' });
  });
});
