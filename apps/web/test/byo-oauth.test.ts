import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real keys so the credential round-trip and the state HMAC run for real —
// those are exactly the parts worth trusting here.
process.env.TOKEN_ENCRYPTION_KEY_V2 = '0'.repeat(64);
process.env.OAUTH_STATE_SECRET = 'a'.repeat(48);

interface StubResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let selectResult: StubResult = { data: null, error: null };

function makeDb() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => selectResult),
    then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
  };
  return { from: vi.fn(() => builder) };
}

vi.mock('../lib/db', async () => {
  const actual = await vi.importActual<typeof import('../lib/db')>('../lib/db');
  return { ...actual, getServiceDb: () => makeDb() };
});

const {
  appOrigin,
  assertOwnRedirectUri,
  byoRedirectUri,
  isOwnRedirectUri,
  isOAuthAppConfigured,
  oauthAppProvider,
  resolveOAuthApp,
} = await import('../lib/auth/byo-oauth');
const { getLinkedInAuthUrl } = await import('../lib/auth/oauth-linkedin');
const { getXAuthUrl } = await import('../lib/auth/oauth-x');
const { verifyOAuthState } = await import('../lib/auth/oauth-state');
const { encrypt } = await import('../lib/auth/encryption');

beforeEach(() => {
  selectResult = { data: null, error: null };
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.prolora.eu';
});

afterEach(() => {
  vi.clearAllMocks();
});

function storedApp(clientId: string, clientSecret: string): StubResult {
  return { data: { credentials: encrypt(JSON.stringify({ clientId, clientSecret })) }, error: null };
}

describe('resolveOAuthApp', () => {
  it('maps each platform to its own credential provider', () => {
    expect(oauthAppProvider('linkedin')).toBe('linkedin_app');
    expect(oauthAppProvider('x')).toBe('x_app');
  });

  it('prefers the workspace app over the process environment', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'env-client';
    process.env.LINKEDIN_CLIENT_SECRET = 'env-secret';
    selectResult = storedApp('ws-client', 'ws-secret');

    await expect(resolveOAuthApp('ws-1', 'linkedin')).resolves.toEqual({
      clientId: 'ws-client',
      clientSecret: 'ws-secret',
      source: 'workspace',
    });
  });

  it('keeps the environment as fallback for single-tenant deployments', async () => {
    process.env.X_CLIENT_ID = 'env-client';
    process.env.X_CLIENT_SECRET = 'env-secret';

    await expect(resolveOAuthApp('ws-1', 'x')).resolves.toEqual({
      clientId: 'env-client',
      clientSecret: 'env-secret',
      source: 'environment',
    });
  });

  it('reports a missing app as an actionable 503 instead of a server fault', async () => {
    await expect(resolveOAuthApp('ws-1', 'linkedin')).rejects.toMatchObject({
      status: 503,
      code: 'oauth_app_missing',
    });
    await expect(isOAuthAppConfigured('ws-1', 'linkedin')).resolves.toBe(false);
  });
});

describe('redirect URI containment', () => {
  it('always builds the callback on this deployment’s own origin', () => {
    expect(appOrigin()).toBe('https://app.prolora.eu');
    expect(byoRedirectUri('linkedin')).toBe('https://app.prolora.eu/api/auth/linkedin/callback');
    expect(byoRedirectUri('x')).toBe('https://app.prolora.eu/api/auth/x/callback');
  });

  it('rejects any callback that is not ours, whatever the workspace stored', () => {
    expect(isOwnRedirectUri('https://app.prolora.eu/api/auth/x/callback')).toBe(true);
    expect(isOwnRedirectUri('https://evil.example/api/auth/x/callback')).toBe(false);
    expect(isOwnRedirectUri('https://app.prolora.eu.evil.example/api/auth/x/callback')).toBe(false);
    expect(isOwnRedirectUri('https://app.prolora.eu/anything-else')).toBe(false);
    expect(isOwnRedirectUri('not a url')).toBe(false);
    expect(() => assertOwnRedirectUri('https://evil.example/api/auth/x/callback')).toThrow();
  });

  it('follows NEXT_PUBLIC_APP_URL rather than a hardcoded host', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    expect(byoRedirectUri('linkedin')).toBe('http://localhost:3000/api/auth/linkedin/callback');
    expect(isOwnRedirectUri('https://app.prolora.eu/api/auth/linkedin/callback')).toBe(false);
  });
});

describe('authorization URLs', () => {
  it('sends the workspace client_id and our own redirect_uri to LinkedIn', async () => {
    process.env.LINKEDIN_CLIENT_ID = 'env-client';
    process.env.LINKEDIN_CLIENT_SECRET = 'env-secret';
    selectResult = storedApp('ws-client', 'ws-secret');

    const { url } = await getLinkedInAuthUrl('workspace-42');
    const params = new URL(url).searchParams;

    expect(params.get('client_id')).toBe('ws-client');
    expect(params.get('redirect_uri')).toBe('https://app.prolora.eu/api/auth/linkedin/callback');
  });

  it('keeps the HMAC-signed state intact for a bring-your-own app', async () => {
    selectResult = storedApp('ws-client', 'ws-secret');

    const { url, state } = await getXAuthUrl('workspace-42', 'challenge-value');
    const params = new URL(url).searchParams;

    expect(params.get('state')).toBe(state);
    expect(params.get('code_challenge')).toBe('challenge-value');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(verifyOAuthState(state)).toEqual({ workspaceId: 'workspace-42' });
  });

  it('rejects a state signed with a different secret', async () => {
    selectResult = storedApp('ws-client', 'ws-secret');
    const { state } = await getXAuthUrl('workspace-42', 'challenge-value');

    const original = process.env.OAUTH_STATE_SECRET;
    process.env.OAUTH_STATE_SECRET = 'b'.repeat(48);
    expect(verifyOAuthState(state)).toBeNull();
    process.env.OAUTH_STATE_SECRET = original;
  });

  it('never puts the client secret in the authorization URL', async () => {
    selectResult = storedApp('ws-client', 'super-secret-value');
    const { url } = await getLinkedInAuthUrl('workspace-42');
    expect(url).not.toContain('super-secret-value');
  });
});
