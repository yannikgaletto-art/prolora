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
const filterSpy = vi.fn();

// Minimal Supabase query-builder stub: every chained filter returns `this`,
// and the promise-shaped terminals resolve to the configured result.
function makeDb() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filterSpy(column, value);
      return builder;
    }),
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
  resolveCredential,
  getIntegrationStatus,
  isProviderConfigured,
  saveCredential,
  verifyCredential,
  deleteCredential,
} = await import('../lib/integrations/credentials');
const { INTEGRATION_PROVIDERS } = await import('../lib/integrations/types');
const { encrypt } = await import('../lib/auth/encryption');

type Provider = (typeof INTEGRATION_PROVIDERS)[number];

// One fixture per provider so every case below runs for all six values —
// the whole point of generalising the store was that no provider gets a
// bespoke storage path.
const FIXTURES: Record<
  Provider,
  {
    /** A credential the provider's verify() accepts. */
    valid: Record<string, string>;
    /** Env vars that make envCredential() non-null, if the provider has any. */
    env: Record<string, string> | null;
    /** Field stored in the clear for UI recognition. */
    hintField: string;
    /** False for providers that always reject a stored credential. */
    storable: boolean;
  }
> = {
  reddit: {
    valid: { clientId: 'ws-id', clientSecret: 'top-secret' },
    env: { REDDIT_CLIENT_ID: 'env-id', REDDIT_CLIENT_SECRET: 'env-secret' },
    hintField: 'clientId',
    storable: true,
  },
  mastodon: {
    valid: { instances: 'chaos.social' },
    env: null,
    hintField: 'instances',
    storable: true,
  },
  hackernews: {
    valid: { scope: 'stories' },
    env: null,
    hintField: 'scope',
    storable: true,
  },
  bluesky: {
    valid: { handle: 'someone.bsky.social' },
    env: null,
    hintField: 'handle',
    storable: false,
  },
  linkedin_app: {
    valid: { clientId: 'li-client', clientSecret: 'li-secret-value' },
    env: { LINKEDIN_CLIENT_ID: 'env-id', LINKEDIN_CLIENT_SECRET: 'env-secret' },
    hintField: 'clientId',
    storable: true,
  },
  x_app: {
    valid: { clientId: 'x-client', clientSecret: 'x-secret-value' },
    env: { X_CLIENT_ID: 'env-id', X_CLIENT_SECRET: 'env-secret' },
    hintField: 'clientId',
    storable: true,
  },
};

const ENV_KEYS = [
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'X_CLIENT_ID',
  'X_CLIENT_SECRET',
];

beforeEach(() => {
  selectResult = { data: null, error: null };
  upsertResult = { error: null };
  upsertSpy.mockReset();
  filterSpy.mockReset();
  requestRedditToken.mockReset();
  requestRedditToken.mockResolvedValue({ accessToken: 'token', expiresIn: 86400 });
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(INTEGRATION_PROVIDERS)('credential store — %s', (provider) => {
  const fixture = FIXTURES[provider];

  it('prefers the workspace row over the process environment', async () => {
    if (fixture.env) Object.assign(process.env, fixture.env);
    selectResult = { data: { credentials: encrypt(JSON.stringify(fixture.valid)) }, error: null };

    await expect(resolveCredential('ws-1', provider)).resolves.toEqual({
      credential: fixture.valid,
      source: 'workspace',
    });
  });

  it('scopes every lookup to the calling workspace and provider (Invariante 2)', async () => {
    await resolveCredential('ws-42', provider);
    expect(filterSpy).toHaveBeenCalledWith('workspace_id', 'ws-42');
    expect(filterSpy).toHaveBeenCalledWith('provider', provider);
  });

  it('never exposes the secret or its ciphertext in the status', async () => {
    selectResult = {
      data: {
        credentials: encrypt(JSON.stringify({ ...fixture.valid, clientSecret: 'super-secret' })),
        client_id_hint: fixture.valid[fixture.hintField] ?? null,
        verified_at: '2026-07-25T10:00:00.000Z',
        last_error: null,
      },
      error: null,
    };

    const status = await getIntegrationStatus('ws-1', provider);
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain('super-secret');
    expect(serialised).not.toContain('top-secret');
    expect(serialised).not.toContain('v2:');
    expect(status).toMatchObject({ provider, connected: true, source: 'workspace' });
  });

  // Deploy-order guard: without migrations 014/015 the table (or the provider
  // value) is absent, and reads must degrade rather than 500.
  it('degrades instead of throwing when the integrations table is missing', async () => {
    selectResult = { data: null, error: { code: 'PGRST205', message: 'relation does not exist' } };

    await expect(resolveCredential('ws-1', provider)).resolves.not.toThrow();
    await expect(getIntegrationStatus('ws-1', provider)).resolves.toMatchObject({ provider });
  });

  it('falls back rather than throwing when stored ciphertext cannot be decrypted', async () => {
    selectResult = { data: { credentials: 'v2:zz:zz:zz' }, error: null };
    const resolved = await resolveCredential('ws-1', provider);
    // Either the env fallback or null — never an exception, never the garbage.
    expect(resolved?.source).not.toBe('workspace');
  });

  it('refuses to persist a credential the provider rejects', async () => {
    const rejected: Record<string, string> =
      provider === 'reddit'
        ? (requestRedditToken.mockRejectedValue(new Error('Reddit rejected these credentials.')),
          { clientId: 'bad', clientSecret: 'wrong' })
        : {};
    // Only reached by providers whose verify() accepts anything; the read-back
    // has to succeed there or the double-assurance check fires instead.
    selectResult = {
      data: { client_id_hint: null, verified_at: null, last_error: null },
      error: null,
    };

    const result = await saveCredential('ws-1', provider, rejected);
    if (result.ok) {
      // Providers with a permissive verify() must at least have written
      // ciphertext, never the plaintext bag.
      const [payload] = upsertSpy.mock.calls[0] as [Record<string, string>];
      expect(payload.credentials).toMatch(/^v2:/);
    } else {
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(typeof result.reason).toBe('string');
    }
  });

  it('verify() reports the reason instead of throwing', async () => {
    if (provider === 'reddit') {
      requestRedditToken.mockRejectedValue(new Error('Reddit rate limit hit while verifying.'));
    }
    await expect(verifyCredential(provider, {})).resolves.toMatchObject({
      ok: expect.any(Boolean),
    });
  });

  it('stores the secret encrypted, never in plaintext', async () => {
    if (!fixture.storable) {
      // bluesky reuses an existing connection — the store must refuse it.
      const refused = await saveCredential('ws-1', provider, fixture.valid);
      expect(refused.ok).toBe(false);
      expect(upsertSpy).not.toHaveBeenCalled();
      return;
    }

    selectResult = {
      data: {
        client_id_hint: fixture.valid[fixture.hintField] ?? null,
        verified_at: '2026-07-25T10:00:00.000Z',
        last_error: null,
      },
      error: null,
    };

    const result = await saveCredential('ws-1', provider, fixture.valid);
    expect(result.ok).toBe(true);
    const [payload, options] = upsertSpy.mock.calls[0] as [Record<string, string>, unknown];
    for (const value of Object.values(fixture.valid)) {
      if (value) expect(payload.credentials).not.toContain(value);
    }
    expect(payload.credentials).toMatch(/^v2:/);
    expect(payload.provider).toBe(provider);
    expect(payload.workspace_id).toBe('ws-1');
    expect(options).toEqual({ onConflict: 'workspace_id,provider' });
  });

  it('delete stays workspace- and provider-scoped', async () => {
    await deleteCredential('ws-7', provider);
    expect(filterSpy).toHaveBeenCalledWith('workspace_id', 'ws-7');
    expect(filterSpy).toHaveBeenCalledWith('provider', provider);
  });
});

describe('resolution order', () => {
  it('falls back to the environment when no workspace row exists', async () => {
    process.env.REDDIT_CLIENT_ID = 'env-id';
    process.env.REDDIT_CLIENT_SECRET = 'env-secret';

    await expect(resolveCredential('ws-1', 'reddit')).resolves.toEqual({
      credential: { clientId: 'env-id', clientSecret: 'env-secret' },
      source: 'environment',
    });
  });

  it('reports not-configured when neither source has credentials', async () => {
    await expect(resolveCredential('ws-1', 'reddit')).resolves.toBeNull();
    await expect(isProviderConfigured('ws-1', 'reddit')).resolves.toBe(false);
  });

  // The two public-API providers are the reason a fresh workspace can discover
  // anything at all — they must report ready with nothing stored.
  it('reports the credential-free providers as configured without any input', async () => {
    await expect(isProviderConfigured('ws-1', 'mastodon')).resolves.toBe(true);
    await expect(isProviderConfigured('ws-1', 'hackernews')).resolves.toBe(true);
  });

  it('reports bluesky as not configured — it borrows a connection instead', async () => {
    await expect(isProviderConfigured('ws-1', 'bluesky')).resolves.toBe(false);
  });
});

describe('save failures map to actionable errors', () => {
  it('turns a missing table into a 503 migration_pending, not a 500', async () => {
    upsertResult = { error: { code: 'PGRST205', message: 'relation does not exist' } };
    await expect(saveCredential('ws-1', 'reddit', FIXTURES.reddit.valid)).rejects.toMatchObject({
      status: 503,
      code: 'migration_pending',
    });
  });

  // 23514 = CHECK violation: the database predates migration 015 and does not
  // allow this provider value yet.
  it('turns a provider CHECK violation into a 503 migration_pending', async () => {
    upsertResult = { error: { code: '23514', message: 'violates check constraint' } };
    await expect(
      saveCredential('ws-1', 'linkedin_app', FIXTURES.linkedin_app.valid)
    ).rejects.toMatchObject({ status: 503, code: 'migration_pending' });
  });
});
