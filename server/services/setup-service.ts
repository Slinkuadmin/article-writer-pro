import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config/index.js';
import { DATA_DIR, ensureDataDir } from '../lib/paths.js';
import { audit } from './audit-service.js';
import { createAdminUser, hasAdminUser } from './auth-service.js';
import { setApiKeyEncrypted, setSetting } from './settings-service.js';
import type { SetupInput } from '../schemas/index.js';

/**
 * First-run setup state.
 *
 * The app is in "setup mode" while no admin user exists. A one-time setup token
 * is generated and printed to the server logs; the setup form must present this
 * token to complete setup. Once an admin exists, setup mode is disabled and the
 * token is invalidated.
 *
 * The token is persisted to the data volume (`DATA_DIR/setup-token`) so it stays
 * valid across container restarts/redeploys — on platforms like Railway the
 * container can restart frequently, and an in-memory-only token would be
 * invalidated on every restart, breaking the setup link printed in the logs.
 */

const SETUP_TOKEN_PATH = path.join(DATA_DIR, 'setup-token');

let setupToken: string | null = null;

/** Read the persisted setup token from disk, if any. */
function readPersistedToken(): string | null {
  try {
    const value = fs.readFileSync(SETUP_TOKEN_PATH, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

/** Persist the setup token to disk so it survives restarts. */
function writePersistedToken(token: string): void {
  try {
    ensureDataDir();
    fs.writeFileSync(SETUP_TOKEN_PATH, token, { mode: 0o600 });
  } catch {
    // Non-fatal: fall back to the in-memory token for this process lifetime.
  }
}

/** Remove the persisted setup token file. */
function removePersistedToken(): void {
  try {
    fs.rmSync(SETUP_TOKEN_PATH, { force: true });
  } catch {
    // Ignore.
  }
}

/**
 * Resolve the public base URL used in the printed setup link. Prefers an
 * explicitly configured public URL, then the Railway-provided public domain,
 * then falls back to localhost for local development.
 */
function resolvePublicBaseUrl(): string {
  const explicit = process.env.PUBLIC_URL || process.env.APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) return `https://${railwayDomain}`;

  return `http://localhost:${config.port}`;
}

/** True when no admin user exists yet. */
export function isSetupRequired(): boolean {
  return !hasAdminUser();
}

/**
 * Ensure a setup token exists when setup is required, and log it. Called on
 * server boot. No-op once an admin exists.
 */
export function ensureSetupToken(): void {
  if (!isSetupRequired()) {
    setupToken = null;
    removePersistedToken();
    return;
  }
  if (!setupToken) {
    // Reuse a previously persisted token so the link survives restarts.
    setupToken = readPersistedToken() ?? crypto.randomBytes(24).toString('hex');
    writePersistedToken(setupToken);
  }
  const base = resolvePublicBaseUrl();
  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '────────────────────────────────────────────────────────',
      ' ArticleWriterPro — FIRST-RUN SETUP REQUIRED',
      ' Open the setup wizard in your browser:',
      `   ${base}/setup?token=${setupToken}`,
      '',
      ' (Set PUBLIC_URL or rely on RAILWAY_PUBLIC_DOMAIN for the public link.)',
      '────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

/** Validate a provided setup token against the active one (constant-time). */
export function isValidSetupToken(token: string | undefined): boolean {
  if (!setupToken || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(setupToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Invalidate the token (after successful setup). */
export function clearSetupToken(): void {
  setupToken = null;
  removePersistedToken();
}

/**
 * Status payload for `GET /api/setup/status`. The raw token is only included in
 * development mode to ease local testing — never in production.
 */
export function getSetupStatus(): { setupRequired: boolean; devToken?: string } {
  const setupRequired = isSetupRequired();
  if (setupRequired && !config.isProduction && setupToken) {
    return { setupRequired, devToken: setupToken };
  }
  return { setupRequired };
}

/**
 * Complete setup: create the admin user and persist initial AI settings (with
 * the API key encrypted). Disables setup mode and invalidates the token.
 */
export async function completeSetup(input: SetupInput): Promise<void> {
  if (!isSetupRequired()) {
    const err = new Error('Setup has already been completed.');
    (err as { status?: number }).status = 409;
    throw err;
  }

  const user = await createAdminUser(input.username, input.email, input.password);

  setSetting('ai_provider_name', input.aiProviderName);
  setSetting('ai_base_url', input.aiBaseUrl);
  setSetting('ai_model', input.aiModel);
  setSetting('default_language', input.defaultLanguage);
  setSetting('default_tone', input.defaultTone);
  setApiKeyEncrypted(input.aiApiKey);

  clearSetupToken();
  audit({ userId: user.id, action: 'setup.complete', entityType: 'user', entityId: user.id });
}
