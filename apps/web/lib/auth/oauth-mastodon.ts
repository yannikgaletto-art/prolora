import { encrypt, decrypt } from '@/lib/auth/encryption';
import { saveConnection } from '@/lib/auth/connections';
import { createOAuthState } from '@/lib/auth/oauth-state';
import { getServiceDb, type MastodonInstanceRow, type ConnectionRow } from '@/lib/db';
import { ApiError } from '@/lib/api/http';

const SCOPES = 'read write';

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

function redirectUri(): string {
  return `${appUrl()}/api/auth/mastodon/callback`;
}

// "https://Mastodon.Social/" -> "mastodon.social"
export function normalizeInstance(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) {
    throw new ApiError(400, 'Invalid Mastodon instance URL.', 'invalid_instance');
  }
  return cleaned;
}

interface InstanceApp {
  clientId: string;
  clientSecret: string;
}

// Mastodon is decentralized: every instance needs its own app registration.
// Registered once per instance, cached in mastodon_instances.
async function getOrRegisterInstanceApp(instance: string): Promise<InstanceApp> {
  const db = getServiceDb();

  const { data: existing, error: lookupError } = await db
    .from('mastodon_instances')
    .select('*')
    .eq('instance_url', instance)
    .maybeSingle<MastodonInstanceRow>();

  if (lookupError) {
    throw new Error(`[oauth-mastodon] instance lookup failed: ${lookupError.message}`);
  }
  if (existing) {
    return { clientId: existing.client_id, clientSecret: decrypt(existing.client_secret_encrypted) };
  }

  let response: Response;
  try {
    response = await fetch(`https://${instance}/api/v1/apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Prolora',
        redirect_uris: redirectUri(),
        scopes: SCOPES,
        website: appUrl(),
      }),
    });
  } catch (error) {
    console.error('[oauth-mastodon] app registration request failed:', error);
    throw new ApiError(502, `Could not reach ${instance}.`, 'platform_unreachable');
  }

  if (!response.ok) {
    console.error('[oauth-mastodon] app registration failed:', response.status, await response.text());
    throw new ApiError(502, `${instance} rejected the app registration.`, 'platform_error');
  }

  const app = (await response.json()) as { client_id?: string; client_secret?: string };
  if (!app.client_id || !app.client_secret) {
    throw new ApiError(502, `${instance} returned an incomplete app registration.`, 'platform_error');
  }

  const { error: insertError } = await db.from('mastodon_instances').insert({
    instance_url: instance,
    client_id: app.client_id,
    client_secret_encrypted: encrypt(app.client_secret),
  });
  if (insertError) {
    // UNIQUE(instance_url) race: another request registered concurrently — reuse theirs.
    const { data: raced } = await db
      .from('mastodon_instances')
      .select('*')
      .eq('instance_url', instance)
      .maybeSingle<MastodonInstanceRow>();
    if (raced) {
      return { clientId: raced.client_id, clientSecret: decrypt(raced.client_secret_encrypted) };
    }
    throw new Error(`[oauth-mastodon] instance insert failed: ${insertError.message}`);
  }

  return { clientId: app.client_id, clientSecret: app.client_secret };
}

export async function getMastodonAuthUrl(workspaceId: string, instanceInput: string): Promise<string> {
  const instance = normalizeInstance(instanceInput);
  const app = await getOrRegisterInstanceApp(instance);
  const state = createOAuthState(workspaceId, instance);

  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `https://${instance}/oauth/authorize?${params}`;
}

export async function handleMastodonCallback(
  code: string,
  workspaceId: string,
  instance: string
): Promise<ConnectionRow> {
  const app = await getOrRegisterInstanceApp(instance);

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(`https://${instance}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: app.clientId,
        client_secret: app.clientSecret,
        redirect_uri: redirectUri(),
        scope: SCOPES,
      }),
    });
  } catch (error) {
    console.error('[oauth-mastodon] token exchange request failed:', error);
    throw new ApiError(502, `Could not reach ${instance}.`, 'platform_unreachable');
  }

  if (!tokenResponse.ok) {
    console.error('[oauth-mastodon] token exchange failed:', tokenResponse.status, await tokenResponse.text());
    throw new ApiError(400, 'Mastodon authorization failed. Please try again.', 'oauth_failed');
  }

  const tokenJson = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new ApiError(502, `${instance} returned no access token.`, 'platform_error');
  }
  const accessToken = tokenJson.access_token;

  // Who is this? (account identity for the connection row)
  const account = await fetchAccount(instance, accessToken);
  // Dynamic character limit per instance (default 500, some run 5000+).
  const maxCharacters = await fetchMaxCharacters(instance);

  return saveConnection({
    workspaceId,
    platform: 'mastodon',
    accountName: `@${account.acct}@${instance}`,
    accountId: `${instance}:${account.id}`,
    avatarUrl: account.avatar ?? null,
    accessTokenEncrypted: encrypt(accessToken),
    scopes: SCOPES.split(' '),
    config: {
      instance_url: `https://${instance}`,
      instance: instance,
      max_characters: maxCharacters,
    },
  });
}

interface MastodonAccount {
  id: string;
  acct: string;
  display_name?: string;
  avatar?: string;
}

async function fetchAccount(instance: string, accessToken: string): Promise<MastodonAccount> {
  const response = await fetch(`https://${instance}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new ApiError(502, `${instance} rejected the new access token.`, 'platform_error');
  }
  const json = (await response.json()) as Partial<MastodonAccount>;
  if (!json.id || !json.acct) {
    throw new ApiError(502, `${instance} returned an incomplete account.`, 'platform_error');
  }
  return json as MastodonAccount;
}

async function fetchMaxCharacters(instance: string): Promise<number> {
  try {
    const v2 = await fetch(`https://${instance}/api/v2/instance`);
    if (v2.ok) {
      const json = (await v2.json()) as {
        configuration?: { statuses?: { max_characters?: number } };
      };
      const limit = json.configuration?.statuses?.max_characters;
      if (typeof limit === 'number' && limit > 0) return limit;
    }
    const v1 = await fetch(`https://${instance}/api/v1/instance`);
    if (v1.ok) {
      const json = (await v1.json()) as { max_toot_chars?: number };
      if (typeof json.max_toot_chars === 'number' && json.max_toot_chars > 0) {
        return json.max_toot_chars;
      }
    }
  } catch (error) {
    console.error(`[oauth-mastodon] max_characters lookup failed for ${instance}:`, error);
  }
  return 500;
}
