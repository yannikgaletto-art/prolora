// Providers that need no credentials at all: Mastodon (public instance API) and
// Hacker News (Algolia). They still appear in the credential store's provider
// union because a workspace may optionally pin configuration — e.g. which
// Mastodon instances to query — and because the status shape is what the UI
// renders uniformly across all providers.
//
// Their status is "connected" without anything stored: there is nothing to
// enter, which is the entire point of putting them first on the Discover page.

import type { CredentialProviderSpec, StoredCredential, VerificationResult } from '../types';

function alwaysAvailable(configField: string): CredentialProviderSpec {
  return {
    hintField: configField,
    // Not an env-configurable provider — but returning a non-null value makes
    // `getIntegrationStatus` report `connected: true` with no user input, which
    // is the honest answer for a public API.
    envCredential(): StoredCredential {
      return { [configField]: '' };
    },
    async verify(): Promise<VerificationResult> {
      return { ok: true };
    },
  };
}

/** Public instance API — no app registration, no keys. */
export const mastodonCredentialSpec = alwaysAvailable('instances');

/** hn.algolia.com — free, keyless. */
export const hackerNewsCredentialSpec = alwaysAvailable('scope');

/**
 * Bluesky discovery reuses the app password the workspace already connected for
 * publishing (`platform_connections`), so nothing is ever stored here. Reporting
 * "not connected" from the credential store is correct: the provider resolves
 * its access from the connection instead, and tells the user to connect Bluesky
 * first when there is none.
 */
export const blueskyCredentialSpec: CredentialProviderSpec = {
  hintField: 'handle',
  envCredential: () => null,
  async verify(): Promise<VerificationResult> {
    return {
      ok: false,
      reason: 'Bluesky discovery uses the Bluesky connection from Channels — connect it there.',
    };
  },
};
