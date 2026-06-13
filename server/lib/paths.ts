import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent, writable data directory.
 *
 * Defaults to `./data` relative to the process working directory. In the
 * production Docker image the working directory is `/app`, so this resolves to
 * `/app/data` out of the box — no environment variables required. Advanced
 * users can override it with the `DATA_DIR` env var.
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

/** Absolute path to the SQLite database file. */
export const DB_PATH = path.join(DATA_DIR, 'app.db');

/** Absolute path to the generated app-secret file. */
export const APP_SECRET_PATH = path.join(DATA_DIR, 'app-secret');

/** Ensure the persistent data directory exists. Safe to call repeatedly. */
export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}
