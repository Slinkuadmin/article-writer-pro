import crypto from 'node:crypto';
import fs from 'node:fs';

import { APP_SECRET_PATH, ensureDataDir } from './paths.js';

let cachedSecret: string | null = null;

/**
 * Returns the application secret used to sign sessions/JWTs and to encrypt
 * sensitive settings (such as the AI API key).
 *
 * Resolution order:
 *  1. `APP_SECRET` env var (optional, for advanced users).
 *  2. Persisted secret at `<DATA_DIR>/app-secret`.
 *  3. A freshly generated random secret, persisted to disk with 0600 perms.
 *
 * Because the secret is stored under the persistent data directory, it (and the
 * database) survive redeploys as long as that directory is mounted as a volume.
 */
export function getAppSecret(): string {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.APP_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    cachedSecret = envSecret;
    return cachedSecret;
  }

  ensureDataDir();

  if (fs.existsSync(APP_SECRET_PATH)) {
    const existing = fs.readFileSync(APP_SECRET_PATH, 'utf8').trim();
    if (existing.length >= 16) {
      cachedSecret = existing;
      return cachedSecret;
    }
  }

  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(APP_SECRET_PATH, generated, { mode: 0o600 });
  // Best-effort tighten perms in case umask widened them.
  try {
    fs.chmodSync(APP_SECRET_PATH, 0o600);
  } catch {
    /* non-fatal */
  }
  cachedSecret = generated;
  return cachedSecret;
}
