// Reddit's half of the credential contract: where the env fallback lives, and
// what "these keys work" means. Everything else (encryption, resolution order,
// schema-drift degradation) is provider-agnostic and stays in credentials.ts.

import {
  forgetRedditToken,
  requestRedditToken,
  type RedditCredentials,
} from '@/lib/discovery/reddit-client';
import type { CredentialProviderSpec, StoredCredential, VerificationResult } from '../types';

/** Narrows the free-form bag to the pair the Reddit client expects. */
export function toRedditCredentials(credential: StoredCredential): RedditCredentials | null {
  const clientId = credential.clientId;
  const clientSecret = credential.clientSecret;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const redditCredentialSpec: CredentialProviderSpec = {
  hintField: 'clientId',

  envCredential(): StoredCredential | null {
    const clientId = process.env.REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  },

  async verify(credential: StoredCredential): Promise<VerificationResult> {
    const pair = toRedditCredentials(credential);
    if (!pair) return { ok: false, reason: 'Client ID and client secret are both required.' };
    try {
      await requestRedditToken(pair);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'Reddit check failed.' };
    }
  },

  onCredentialChanged(hint) {
    if (hint) forgetRedditToken(hint);
  },
};
