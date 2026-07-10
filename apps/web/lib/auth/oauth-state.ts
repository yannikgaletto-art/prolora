import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  w: string; // workspace_id
  i?: string; // mastodon instance (optional)
  t: number; // issued-at (ms)
  n: string; // nonce
}

export interface VerifiedState {
  workspaceId: string;
  instance?: string;
}

function getStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('OAUTH_STATE_SECRET must be set (min 32 chars) for OAuth flows');
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
}

// state = base64url(JSON payload) + "." + HMAC-SHA256(payload)
export function createOAuthState(workspaceId: string, instance?: string): string {
  const payload: StatePayload = {
    w: workspaceId,
    ...(instance ? { i: instance } : {}),
    t: Date.now(),
    n: randomBytes(16).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

// Returns null on ANY validation failure (bad format, bad HMAC, expired).
export function verifyOAuthState(state: string): VerifiedState | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;

  const expected = sign(encoded);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return null;
  }

  if (typeof payload.w !== 'string' || typeof payload.t !== 'number') return null;
  if (Date.now() - payload.t > STATE_MAX_AGE_MS) return null;

  return { workspaceId: payload.w, ...(payload.i ? { instance: payload.i } : {}) };
}
