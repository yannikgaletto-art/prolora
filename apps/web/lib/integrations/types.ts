// Types shared between the credential store and the provider specs.
//
// This module has NO runtime imports on purpose. The specs need these types and
// the store needs the specs; keeping the types here means that relationship is
// a type-only edge and never becomes an import cycle at runtime.

/**
 * Every provider that can own workspace credentials. Must stay in sync with the
 * CHECK constraint in migration 015 — a value missing there fails the write.
 */
export type IntegrationProvider =
  | 'reddit'
  | 'mastodon'
  | 'hackernews'
  | 'bluesky'
  | 'linkedin_app'
  | 'x_app';

export const INTEGRATION_PROVIDERS: readonly IntegrationProvider[] = [
  'reddit',
  'mastodon',
  'hackernews',
  'bluesky',
  'linkedin_app',
  'x_app',
] as const;

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export type CredentialSource = 'workspace' | 'environment';

/** Free-form field bag. Providers define their own field names. */
export interface StoredCredential {
  [field: string]: string;
}

export interface ResolvedCredential {
  credential: StoredCredential;
  source: CredentialSource;
}

/** Everything the browser is allowed to know. No secret, not even encrypted. */
export interface IntegrationStatus {
  provider: IntegrationProvider;
  connected: boolean;
  source: CredentialSource | null;
  /** Non-secret half of the pair, shown so the user recognises their app. */
  clientIdHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
}

export type VerificationResult = { ok: true } | { ok: false; reason: string };

/**
 * What a provider has to contribute. Deliberately tiny: storage, secrecy and
 * degradation rules are identical for everyone and live in credentials.ts.
 */
export interface CredentialProviderSpec {
  /** Env fallback, so existing deployments keep working. `null` = none. */
  envCredential(): StoredCredential | null;
  /** Field whose value is safe to store in the clear for UI recognition. */
  hintField: string;
  /**
   * Live check against the provider. Returns the reason instead of throwing —
   * "your key pair is wrong" is form validation, not a server error.
   */
  verify(credential: StoredCredential): Promise<VerificationResult>;
  /** Called after the stored credential changed, e.g. to drop a token cache. */
  onCredentialChanged?(hint: string | null): void;
}
