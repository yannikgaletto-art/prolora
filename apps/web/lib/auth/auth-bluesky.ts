import { encrypt } from '@/lib/auth/encryption';
import { saveConnection } from '@/lib/auth/connections';
import { ApiError } from '@/lib/api/http';
import type { ConnectionRow } from '@/lib/db';

const BSKY_SERVICE = 'https://bsky.social';

interface CreateSessionResponse {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
}

// No OAuth: validate the app password by creating a session, then store it
// encrypted. Sessions are re-created on demand by the adapter.
export async function connectBluesky(
  workspaceId: string,
  handle: string,
  appPassword: string
): Promise<ConnectionRow> {
  const normalizedHandle = handle.trim().replace(/^@/, '').toLowerCase();
  if (!normalizedHandle || !appPassword.trim()) {
    throw new ApiError(400, 'Handle and app password are required.', 'invalid_request');
  }

  let response: Response;
  try {
    response = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: normalizedHandle, password: appPassword }),
    });
  } catch (error) {
    console.error('[auth-bluesky] createSession request failed:', error);
    throw new ApiError(502, 'Could not reach Bluesky. Please try again.', 'platform_unreachable');
  }

  if (response.status === 401 || response.status === 400) {
    throw new ApiError(400, 'Invalid Bluesky handle or app password.', 'invalid_credentials');
  }
  if (!response.ok) {
    console.error('[auth-bluesky] createSession failed:', response.status, await response.text());
    throw new ApiError(502, 'Bluesky returned an unexpected error.', 'platform_error');
  }

  const session = (await response.json()) as Partial<CreateSessionResponse>;
  if (!session.did || !session.handle) {
    throw new ApiError(502, 'Bluesky session response was incomplete.', 'platform_error');
  }

  return saveConnection({
    workspaceId,
    platform: 'bluesky',
    accountName: session.handle,
    accountId: session.did,
    appPasswordEncrypted: encrypt(appPassword),
    config: {
      handle: session.handle,
      did: session.did,
      service: BSKY_SERVICE,
    },
  });
}
