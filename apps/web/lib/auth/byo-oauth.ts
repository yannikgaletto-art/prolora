// Bring-your-own OAuth apps for LinkedIn and X.
//
// LinkedIn and X hand out client credentials per developer account, and both
// gate the publishing scopes behind a review only the account owner can pass.
// A single operator-owned app therefore cannot serve every workspace, which is
// why "Operator OAuth setup required" was a dead end rather than a to-do: the
// person reading it was the only one who *could* fix it, and the UI gave them
// no way to.
//
// This module is the seam. Client ID and secret come from the workspace's own
// credential row (lib/integrations/credentials.ts, providers linkedin_app /
// x_app) with the process env as fallback, so existing single-tenant
// deployments keep working untouched.
//
// Security: only the ID/secret pair becomes workspace-controlled. The redirect
// URI is always derived from this deployment's own NEXT_PUBLIC_APP_URL and is
// never read from stored credentials — otherwise a workspace could point the
// authorization code at a host it controls. The CSRF state stays HMAC-signed by
// OAUTH_STATE_SECRET (lib/auth/oauth-state.ts) exactly as before: a foreign
// client_id changes who issues the token, not who may start or finish a flow.

import { ApiError } from '@/lib/api/http';
import { resolveCredential } from '@/lib/integrations/credentials';
import type { CredentialSource, IntegrationProvider } from '@/lib/integrations/types';

export type ByoOAuthPlatform = 'linkedin' | 'x';

export type OAuthAppProvider = Extract<IntegrationProvider, 'linkedin_app' | 'x_app'>;

const PROVIDER_BY_PLATFORM: Record<ByoOAuthPlatform, OAuthAppProvider> = {
  linkedin: 'linkedin_app',
  x: 'x_app',
};

const PLATFORM_LABELS: Record<ByoOAuthPlatform, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
};

export function isByoOAuthPlatform(value: string): value is ByoOAuthPlatform {
  return value === 'linkedin' || value === 'x';
}

export function oauthAppProvider(platform: ByoOAuthPlatform): OAuthAppProvider {
  return PROVIDER_BY_PLATFORM[platform];
}

export function oauthPlatformLabel(platform: ByoOAuthPlatform): string {
  return PLATFORM_LABELS[platform];
}

/** This deployment's own origin. Throws rather than silently redirecting off-host. */
export function appOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    throw new ApiError(500, 'NEXT_PUBLIC_APP_URL is not a valid URL.', 'app_url_invalid');
  }
}

/** The one redirect URI we ever send to a provider — always our own callback. */
export function byoRedirectUri(platform: ByoOAuthPlatform): string {
  return `${appOrigin()}/api/auth/${platform}/callback`;
}

/** True only for callback URLs on this deployment's own origin. */
export function isOwnRedirectUri(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  return url.origin === appOrigin() && /^\/api\/auth\/[^/]+\/callback$/.test(url.pathname);
}

/**
 * Belt-and-braces before every provider call: a redirect URI that is not ours
 * must never reach LinkedIn or X, no matter how it was assembled.
 */
export function assertOwnRedirectUri(candidate: string): string {
  if (!isOwnRedirectUri(candidate)) {
    throw new ApiError(500, 'Refusing to start OAuth with a foreign redirect URI.', 'redirect_uri_rejected');
  }
  return candidate;
}

export interface ResolvedOAuthApp {
  clientId: string;
  clientSecret: string;
  source: CredentialSource;
}

/**
 * Workspace row before env (lib/integrations/credentials.ts). Throws a 503 with
 * a structured code so the UI can offer the BYO setup panel instead of a
 * dead-end "ask your operator".
 */
export async function resolveOAuthApp(
  workspaceId: string,
  platform: ByoOAuthPlatform
): Promise<ResolvedOAuthApp> {
  const resolved = await resolveCredential(workspaceId, PROVIDER_BY_PLATFORM[platform]);
  const clientId = resolved?.credential.clientId?.trim();
  const clientSecret = resolved?.credential.clientSecret?.trim();

  if (!resolved || !clientId || !clientSecret) {
    throw new ApiError(
      503,
      `No ${PLATFORM_LABELS[platform]} app is connected to this workspace yet. Add your own app to continue.`,
      'oauth_app_missing'
    );
  }
  return { clientId, clientSecret, source: resolved.source };
}

export async function isOAuthAppConfigured(
  workspaceId: string,
  platform: ByoOAuthPlatform
): Promise<boolean> {
  const resolved = await resolveCredential(workspaceId, PROVIDER_BY_PLATFORM[platform]);
  return Boolean(resolved?.credential.clientId?.trim() && resolved.credential.clientSecret?.trim());
}
