// Where Reddit API credentials come from, and how they get there.
//
// Before migration 014 the only source was REDDIT_CLIENT_ID/SECRET in the
// process env, so the Discover page could only tell the user that "the
// operator" had to edit a file — a dead end for a user who *is* the operator.
// Credentials are now workspace-owned and enterable from the UI.
//
// Resolution order: the workspace row wins, env is the fallback. That keeps
// existing single-tenant deployments working untouched while letting a
// workspace override them without a redeploy.
//
// Secrets never leave this module in plaintext: `getRedditIntegrationStatus`
// is the only shape the API layer is allowed to serialise (Invariante 2 —
// every query is scoped by an explicit workspace_id).

import { decrypt, encrypt } from '@/lib/auth/encryption';
import { ApiError } from '@/lib/api/http';
import {
  getServiceDb,
  isMissingSchemaError,
  WORKSPACE_INTEGRATION_PUBLIC_COLUMNS,
  type WorkspaceIntegrationRow,
} from '@/lib/db';
import {
  RedditClient,
  forgetRedditToken,
  requestRedditToken,
  type RedditCredentials,
} from '@/lib/discovery/reddit-client';

export type { RedditCredentials };

export type CredentialSource = 'workspace' | 'environment';

export interface ResolvedRedditCredentials {
  credentials: RedditCredentials;
  source: CredentialSource;
}

/** Everything the browser is allowed to know. No secret, not even encrypted. */
export interface RedditIntegrationStatus {
  connected: boolean;
  source: CredentialSource | null;
  /** Non-secret half of the key pair, shown so the user recognises the app. */
  clientIdHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

function envCredentials(): RedditCredentials | null {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
}

async function readWorkspaceRow(
  workspaceId: string,
  columns: string
): Promise<WorkspaceIntegrationRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspace_integrations')
    .select(columns)
    .eq('workspace_id', workspaceId)
    .eq('provider', 'reddit')
    .maybeSingle<WorkspaceIntegrationRow>();

  if (error) {
    // Read path degrades (see isMissingSchemaError): without migration 014 the
    // env fallback still works, so Discover must not 500 over a deploy-order gap.
    if (isMissingSchemaError(error.code)) {
      console.error(
        '[integrations:reddit] workspace_integrations missing — apply migration 014:',
        error.message
      );
      return null;
    }
    throw new Error(`[integrations:reddit] lookup failed: ${error.message}`);
  }
  return data ?? null;
}

/** Full credentials for server-side use. Never serialise the result. */
export async function resolveRedditCredentials(
  workspaceId: string
): Promise<ResolvedRedditCredentials | null> {
  const row = await readWorkspaceRow(workspaceId, 'credentials');
  if (row?.credentials) {
    try {
      const stored = JSON.parse(decrypt(row.credentials)) as StoredCredentials;
      if (stored.clientId && stored.clientSecret) {
        return { credentials: stored, source: 'workspace' };
      }
      console.error('[integrations:reddit] stored credentials incomplete, falling back to env');
    } catch (error) {
      // A rotated TOKEN_ENCRYPTION_KEY without re-entry lands here. Falling
      // back beats hard-failing a workspace that also has env credentials.
      console.error('[integrations:reddit] could not decrypt stored credentials:', error);
    }
  }

  const fromEnv = envCredentials();
  return fromEnv ? { credentials: fromEnv, source: 'environment' } : null;
}

export async function getRedditIntegrationStatus(
  workspaceId: string
): Promise<RedditIntegrationStatus> {
  const row = await readWorkspaceRow(workspaceId, WORKSPACE_INTEGRATION_PUBLIC_COLUMNS);
  if (row) {
    return {
      connected: true,
      source: 'workspace',
      clientIdHint: row.client_id_hint,
      verifiedAt: row.verified_at,
      lastError: row.last_error,
    };
  }
  if (envCredentials()) {
    return {
      connected: true,
      source: 'environment',
      clientIdHint: null,
      verifiedAt: null,
      lastError: null,
    };
  }
  return { connected: false, source: null, clientIdHint: null, verifiedAt: null, lastError: null };
}

export async function isRedditConfigured(workspaceId: string): Promise<boolean> {
  return (await resolveRedditCredentials(workspaceId)) !== null;
}

/**
 * Live check against Reddit. Returns the failure reason rather than throwing,
 * because "your key pair is wrong" is a form-validation result, not a server
 * error — the setup UI shows it inline.
 */
export async function verifyRedditCredentials(
  credentials: RedditCredentials
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await requestRedditToken(credentials);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Reddit check failed.' };
  }
}

/**
 * Verify-then-persist: credentials that Reddit rejects are never written, so a
 * connected integration is always a working one.
 */
export async function saveRedditCredentials(
  workspaceId: string,
  credentials: RedditCredentials
): Promise<{ ok: true; status: RedditIntegrationStatus } | { ok: false; reason: string }> {
  const verification = await verifyRedditCredentials(credentials);
  if (!verification.ok) return verification;

  const db = getServiceDb();
  const verifiedAt = new Date().toISOString();
  const { error } = await db
    .from('workspace_integrations')
    .upsert(
      {
        workspace_id: workspaceId,
        provider: 'reddit',
        credentials: encrypt(JSON.stringify(credentials)),
        client_id_hint: credentials.clientId,
        verified_at: verifiedAt,
        last_error: null,
        updated_at: verifiedAt,
      },
      { onConflict: 'workspace_id,provider' }
    );

  if (error) {
    if (isMissingSchemaError(error.code)) {
      throw new ApiError(
        503,
        'The integrations table is missing. Apply migration 014 (npm run db:migrate), then connect again.',
        'migration_pending'
      );
    }
    throw new Error(`[integrations:reddit] save failed: ${error.message}`);
  }

  // Double assurance: read the row back before reporting success, so a silently
  // dropped write cannot present itself as a connected integration.
  const readBack = await readWorkspaceRow(workspaceId, WORKSPACE_INTEGRATION_PUBLIC_COLUMNS);
  if (!readBack) {
    throw new Error('[integrations:reddit] save verification failed: row not found after write');
  }

  forgetRedditToken(credentials.clientId);
  return {
    ok: true,
    status: {
      connected: true,
      source: 'workspace',
      clientIdHint: readBack.client_id_hint,
      verifiedAt: readBack.verified_at,
      lastError: null,
    },
  };
}

export async function deleteRedditCredentials(workspaceId: string): Promise<void> {
  const row = await readWorkspaceRow(workspaceId, WORKSPACE_INTEGRATION_PUBLIC_COLUMNS);
  const db = getServiceDb();
  const { error } = await db
    .from('workspace_integrations')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('provider', 'reddit');

  if (error && !isMissingSchemaError(error.code)) {
    throw new Error(`[integrations:reddit] delete failed: ${error.message}`);
  }
  if (row?.client_id_hint) forgetRedditToken(row.client_id_hint);
}

/**
 * The client every Reddit consumer should use. Throws a structured 503 rather
 * than an opaque error so the UI can offer the setup flow instead of a stack.
 */
export async function getRedditClientForWorkspace(workspaceId: string): Promise<RedditClient> {
  const resolved = await resolveRedditCredentials(workspaceId);
  if (!resolved) {
    throw new ApiError(
      503,
      'Reddit is not connected for this workspace yet.',
      'reddit_not_connected'
    );
  }
  return new RedditClient(resolved.credentials);
}
