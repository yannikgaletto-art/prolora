// LinkedIn's and X's OAuth *app* credentials (client ID + secret), so a user can
// point Prolora at their own developer app instead of waiting for the operator
// to set LINKEDIN_CLIENT_ID / X_CLIENT_ID in an env file they cannot reach.
//
// Why verification here is structural, not a live call: an OAuth app's client
// secret cannot be checked without completing an authorization round-trip —
// there is no equivalent of Reddit's client_credentials probe. The real proof is
// the redirect dance itself, which is why the BYO-OAuth flow re-stamps
// `verified_at` once a connection is actually established. Storing an
// unverifiable pair is safe: nothing is granted by it, and the OAuth attempt
// fails loudly at the provider if it is wrong.

import type { CredentialProviderSpec, StoredCredential, VerificationResult } from '../types';

function envPair(idVar: string, secretVar: string): StoredCredential | null {
  const clientId = process.env[idVar];
  const clientSecret = process.env[secretVar];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function verifyStructurally(credential: StoredCredential): Promise<VerificationResult> {
  const clientId = credential.clientId?.trim();
  const clientSecret = credential.clientSecret?.trim();
  if (!clientId || !clientSecret) {
    return { ok: false, reason: 'Client ID and client secret are both required.' };
  }
  if (clientId.length < 6 || clientSecret.length < 6) {
    return { ok: false, reason: 'That does not look like a complete client ID / secret pair.' };
  }
  return { ok: true };
}

export const linkedInAppCredentialSpec: CredentialProviderSpec = {
  hintField: 'clientId',
  envCredential: () => envPair('LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'),
  verify: verifyStructurally,
};

export const xAppCredentialSpec: CredentialProviderSpec = {
  hintField: 'clientId',
  envCredential: () => envPair('X_CLIENT_ID', 'X_CLIENT_SECRET'),
  verify: verifyStructurally,
};
