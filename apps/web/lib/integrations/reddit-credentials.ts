// Reddit-shaped view of the generic credential store (lib/integrations/credentials.ts).
//
// This module used to *be* the store. It stayed behind as a thin adapter so the
// generalisation did not have to land as one atomic rename across the discovery
// layer, the system doctor and their tests — callers migrate to the generic API
// on their own schedule. The Reddit specifics (env var names, verification via
// client_credentials, token-cache invalidation) now live in
// lib/integrations/providers/reddit.ts.

import { ApiError } from '@/lib/api/http';
import { RedditClient, type RedditCredentials } from '@/lib/discovery/reddit-client';
import {
  deleteCredential,
  getIntegrationStatus,
  isProviderConfigured,
  resolveCredential,
  saveCredential,
  verifyCredential,
} from './credentials';
import { toRedditCredentials } from './providers/reddit';
import type { CredentialSource } from './types';

export type { RedditCredentials };
export type { CredentialSource };

export interface ResolvedRedditCredentials {
  credentials: RedditCredentials;
  source: CredentialSource;
}

/** Everything the browser is allowed to know. No secret, not even encrypted. */
export interface RedditIntegrationStatus {
  connected: boolean;
  source: CredentialSource | null;
  clientIdHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

/** Full credentials for server-side use. Never serialise the result. */
export async function resolveRedditCredentials(
  workspaceId: string
): Promise<ResolvedRedditCredentials | null> {
  const resolved = await resolveCredential(workspaceId, 'reddit');
  if (!resolved) return null;
  const pair = toRedditCredentials(resolved.credential);
  return pair ? { credentials: pair, source: resolved.source } : null;
}

export async function getRedditIntegrationStatus(
  workspaceId: string
): Promise<RedditIntegrationStatus> {
  const { connected, source, clientIdHint, verifiedAt, lastError } = await getIntegrationStatus(
    workspaceId,
    'reddit'
  );
  return { connected, source, clientIdHint, verifiedAt, lastError };
}

export async function isRedditConfigured(workspaceId: string): Promise<boolean> {
  return isProviderConfigured(workspaceId, 'reddit');
}

export function verifyRedditCredentials(
  credentials: RedditCredentials
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return verifyCredential('reddit', { ...credentials });
}

/**
 * Verify-then-persist: credentials that Reddit rejects are never written, so a
 * connected integration is always a working one.
 */
export async function saveRedditCredentials(
  workspaceId: string,
  credentials: RedditCredentials
): Promise<{ ok: true; status: RedditIntegrationStatus } | { ok: false; reason: string }> {
  const result = await saveCredential(workspaceId, 'reddit', { ...credentials });
  if (!result.ok) return result;
  const { connected, source, clientIdHint, verifiedAt, lastError } = result.status;
  return { ok: true, status: { connected, source, clientIdHint, verifiedAt, lastError } };
}

export function deleteRedditCredentials(workspaceId: string): Promise<void> {
  return deleteCredential(workspaceId, 'reddit');
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
