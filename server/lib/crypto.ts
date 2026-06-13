import crypto from 'node:crypto';

import { getAppSecret } from './appSecret.js';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

/** Derive a stable 32-byte key from the app secret. */
function deriveKey(): Buffer {
  return crypto.createHash('sha256').update(getAppSecret(), 'utf8').digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a key derived from the app
 * secret. Output format: `enc:v1:<base64(iv)>:<base64(tag)>:<base64(cipher)>`.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Returns true if the value looks like an `encryptSecret` output. */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Decrypt a value produced by {@link encryptSecret}. If the value is not in the
 * encrypted format it is returned unchanged (supports gradual migration).
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;
  const body = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted value');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Mask a secret for display, e.g. `sk-1234...wxyz` -> `sk-1****wxyz`.
 * Never returns the full secret. Returns an empty string for empty input.
 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  const visible = 4;
  if (secret.length <= visible * 2) {
    return `${secret.slice(0, 1)}****`;
  }
  return `${secret.slice(0, visible)}****${secret.slice(-visible)}`;
}
