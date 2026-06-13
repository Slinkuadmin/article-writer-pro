import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from '../lib/paths.js';

/**
 * Minimal .env loader (no external dependency required for booting).
 *
 * `.env` is entirely OPTIONAL. The app boots with safe defaults when no
 * environment is configured ("zero-env" mode). Advanced users may provide a
 * `.env` file for manual configuration — see `.env.example`.
 */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Do not override variables already present in the real environment.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';

/**
 * Centralized, zero-env application configuration with safe defaults.
 * No secrets are hardcoded here — secrets live in the encrypted settings store
 * and the generated app-secret file.
 */
export const config = {
  env: NODE_ENV,
  isProduction,
  port: toInt(process.env.PORT, 3001),
  dataDir: DATA_DIR,

  /**
   * CORS allowlist. Empty by default: in production the frontend is served from
   * the same origin as the API, so no cross-origin access is needed. In
   * development, the Vite dev server origins are allowed automatically.
   */
  corsOrigins: parseList(process.env.CORS_ORIGINS),

  /** Maximum accepted JSON/body size. */
  bodyLimit: process.env.BODY_LIMIT ?? '2mb',

  /** Global rate limit window (ms) and max requests per window. */
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMax: toInt(process.env.RATE_LIMIT_MAX, 1000),

  /** Stricter rate limit for auth/setup endpoints. */
  authRateLimitMax: toInt(process.env.AUTH_RATE_LIMIT_MAX, 30),

  /** Trust proxy (needed behind Railway/Easypanel/Nginx for correct client IPs). */
  trustProxy: (process.env.TRUST_PROXY ?? 'true') !== 'false',
} as const;

export type AppConfig = typeof config;
