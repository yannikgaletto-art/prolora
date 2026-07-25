// Workspace-owned third-party credentials — the provider-agnostic core.
//
// Migration 014 built this for Reddit alone, to end the dead end where the UI
// told the user that "the operator" had to set REDDIT_CLIENT_ID while the user
// *was* the operator. Every further provider hits the same wall, so the
// mechanism is generic here and a provider contributes only two things: which
// env vars are its fallback, and how a pasted credential is verified.
//
// Resolution order is workspace-row-before-env, always: an existing
// single-tenant deployment keeps working untouched, and a workspace can still
// override it without a redeploy.
//
// Secrets never leave this module in plaintext. `getIntegrationStatus` is the
// only shape the API layer may serialise (Invariante 2 — every query carries an
// explicit workspace_id).
//
// Specs are wired statically below rather than registering themselves on import:
// side-effect registration would depend on module evaluation order, and a
// provider whose module happened not to be imported yet would silently resolve
// to "not configured".

import { decrypt, encrypt } from '@/lib/auth/encryption';
import { ApiError } from '@/lib/api/http';
import {
  getServiceDb,
  isMissingSchemaError,
  WORKSPACE_INTEGRATION_PUBLIC_COLUMNS,
  type WorkspaceIntegrationRow,
} from '@/lib/db';
import type {
  CredentialProviderSpec,
  IntegrationProvider,
  IntegrationStatus,
  ResolvedCredential,
  StoredCredential,
  VerificationResult,
} from './types';
import { redditCredentialSpec } from './providers/reddit';
import {
  blueskyCredentialSpec,
  hackerNewsCredentialSpec,
  mastodonCredentialSpec,
} from './providers/public-api';
import { linkedInAppCredentialSpec, xAppCredentialSpec } from './providers/oauth-apps';

export type {
  CredentialProviderSpec,
  CredentialSource,
  IntegrationProvider,
  IntegrationStatus,
  ResolvedCredential,
  StoredCredential,
  VerificationResult,
} from './types';
export { INTEGRATION_PROVIDERS, isIntegrationProvider } from './types';

const SPECS: Record<IntegrationProvider, CredentialProviderSpec> = {
  reddit: redditCredentialSpec,
  mastodon: mastodonCredentialSpec,
  hackernews: hackerNewsCredentialSpec,
  bluesky: blueskyCredentialSpec,
  linkedin_app: linkedInAppCredentialSpec,
  x_app: xAppCredentialSpec,
};

async function readWorkspaceRow(
  workspaceId: string,
  provider: IntegrationProvider,
  columns: string
): Promise<WorkspaceIntegrationRow | null> {
  const db = getServiceDb();
  const { data, error } = await db
    .from('workspace_integrations')
    .select(columns)
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .maybeSingle<WorkspaceIntegrationRow>();

  if (error) {
    // Read paths degrade rather than 500: without migration 014/015 the env
    // fallback still works, and a deploy-order gap must not break Discover.
    if (isMissingSchemaError(error.code)) {
      console.error(
        `[integrations:${provider}] workspace_integrations unavailable — apply migrations 014/015:`,
        error.message
      );
      return null;
    }
    throw new Error(`[integrations:${provider}] lookup failed: ${error.message}`);
  }
  return data ?? null;
}

/** Full credential for server-side use. Never serialise the result. */
export async function resolveCredential(
  workspaceId: string,
  provider: IntegrationProvider
): Promise<ResolvedCredential | null> {
  const row = await readWorkspaceRow(workspaceId, provider, 'credentials');
  if (row?.credentials) {
    try {
      const stored = JSON.parse(decrypt(row.credentials)) as StoredCredential;
      const hasValues =
        stored !== null &&
        typeof stored === 'object' &&
        Object.values(stored).some((value) => typeof value === 'string' && value.length > 0);
      if (hasValues) return { credential: stored, source: 'workspace' };
      console.error(`[integrations:${provider}] stored credential empty, falling back to env`);
    } catch (error) {
      // A rotated TOKEN_ENCRYPTION_KEY without re-entry lands here. Falling
      // back beats hard-failing a workspace that also has env credentials.
      console.error(`[integrations:${provider}] could not decrypt stored credential:`, error);
    }
  }

  const fromEnv = SPECS[provider].envCredential();
  return fromEnv ? { credential: fromEnv, source: 'environment' } : null;
}

export async function getIntegrationStatus(
  workspaceId: string,
  provider: IntegrationProvider
): Promise<IntegrationStatus> {
  const row = await readWorkspaceRow(workspaceId, provider, WORKSPACE_INTEGRATION_PUBLIC_COLUMNS);
  if (row) {
    return {
      provider,
      connected: true,
      source: 'workspace',
      clientIdHint: row.client_id_hint,
      verifiedAt: row.verified_at,
      lastError: row.last_error,
    };
  }
  if (SPECS[provider].envCredential()) {
    return {
      provider,
      connected: true,
      source: 'environment',
      clientIdHint: null,
      verifiedAt: null,
      lastError: null,
    };
  }
  return {
    provider,
    connected: false,
    source: null,
    clientIdHint: null,
    verifiedAt: null,
    lastError: null,
  };
}

export async function isProviderConfigured(
  workspaceId: string,
  provider: IntegrationProvider
): Promise<boolean> {
  return (await resolveCredential(workspaceId, provider)) !== null;
}

export function verifyCredential(
  provider: IntegrationProvider,
  credential: StoredCredential
): Promise<VerificationResult> {
  return SPECS[provider].verify(credential);
}

/**
 * Verify-then-persist: a credential the provider rejects is never written, so a
 * connected integration is always a working one.
 */
export async function saveCredential(
  workspaceId: string,
  provider: IntegrationProvider,
  credential: StoredCredential
): Promise<{ ok: true; status: IntegrationStatus } | { ok: false; reason: string }> {
  const spec = SPECS[provider];
  const verification = await spec.verify(credential);
  if (!verification.ok) return verification;

  const db = getServiceDb();
  const verifiedAt = new Date().toISOString();
  const hint = credential[spec.hintField] ?? null;
  const { error } = await db
    .from('workspace_integrations')
    .upsert(
      {
        workspace_id: workspaceId,
        provider,
        credentials: encrypt(JSON.stringify(credential)),
        client_id_hint: hint,
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
    // 23514 = CHECK violation: this database predates migration 015, so the
    // provider value is not allowed yet. Same deploy-order class of problem as
    // a missing table, so the same actionable 503 instead of an opaque 500.
    if (error.code === '23514') {
      throw new ApiError(
        503,
        `"${provider}" is not enabled on this database yet. Apply migration 015, then connect again.`,
        'migration_pending'
      );
    }
    throw new Error(`[integrations:${provider}] save failed: ${error.message}`);
  }

  // Double assurance: read the row back before reporting success, so a silently
  // dropped write cannot present itself as a connected integration.
  const readBack = await readWorkspaceRow(
    workspaceId,
    provider,
    WORKSPACE_INTEGRATION_PUBLIC_COLUMNS
  );
  if (!readBack) {
    throw new Error(
      `[integrations:${provider}] save verification failed: row not found after write`
    );
  }

  spec.onCredentialChanged?.(hint);
  return {
    ok: true,
    status: {
      provider,
      connected: true,
      source: 'workspace',
      clientIdHint: readBack.client_id_hint,
      verifiedAt: readBack.verified_at,
      lastError: null,
    },
  };
}

export async function deleteCredential(
  workspaceId: string,
  provider: IntegrationProvider
): Promise<void> {
  const row = await readWorkspaceRow(workspaceId, provider, WORKSPACE_INTEGRATION_PUBLIC_COLUMNS);
  const db = getServiceDb();
  const { error } = await db
    .from('workspace_integrations')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('provider', provider);

  if (error && !isMissingSchemaError(error.code)) {
    throw new Error(`[integrations:${provider}] delete failed: ${error.message}`);
  }
  SPECS[provider].onCredentialChanged?.(row?.client_id_hint ?? null);
}
