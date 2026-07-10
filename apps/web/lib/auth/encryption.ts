import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const CURRENT_VERSION = 'v2';

function getKeyForVersion(version: string): Buffer {
  const envKey = version === 'v1'
    ? process.env.TOKEN_ENCRYPTION_KEY_V1
    : process.env.TOKEN_ENCRYPTION_KEY_V2;

  if (!envKey) {
    if (version === 'v1') {
      throw new Error(`Encryption key for ${version} not found — cannot decrypt legacy data`);
    }
    const fallback = process.env.TOKEN_ENCRYPTION_KEY;
    if (!fallback) {
      throw new Error('TOKEN_ENCRYPTION_KEY_V2 (or TOKEN_ENCRYPTION_KEY) must be set');
    }
    return Buffer.from(fallback, 'hex');
  }
  return Buffer.from(envKey, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKeyForVersion(CURRENT_VERSION);
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${CURRENT_VERSION}:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');

  let version: string;
  let ivHex: string;
  let authTagHex: string;
  let encryptedHex: string;

  if (parts.length === 4) {
    [version, ivHex, authTagHex, encryptedHex] = parts;
  } else if (parts.length === 3) {
    // Legacy format without version prefix — treat as v1
    version = 'v1';
    [ivHex, authTagHex, encryptedHex] = parts;
  } else {
    throw new Error('Invalid ciphertext format');
  }

  const key = getKeyForVersion(version);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function needsMigration(ciphertext: string): boolean {
  return !ciphertext.startsWith(`${CURRENT_VERSION}:`);
}

export function migrateEncryption(ciphertext: string): string {
  if (!needsMigration(ciphertext)) return ciphertext;
  const plaintext = decrypt(ciphertext);
  return encrypt(plaintext);
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomPart = randomBytes(32).toString('base64url');
  const key = `sk_live_${randomPart}`;
  const prefix = key.slice(0, 14);
  const hash = hashApiKey(key);
  return { key, prefix, hash };
}
