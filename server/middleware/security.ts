import type { CorsOptions } from 'cors';
import cors from 'cors';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { config } from '../config/index.js';

/** Origins always permitted during local development. */
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

/**
 * CORS configuration backed by an allowlist. In production only origins listed
 * in `CORS_ORIGINS` are allowed (the bundled SPA is same-origin, so it needs no
 * entry). Requests without an `Origin` header (curl, same-origin, health
 * checks) are always allowed.
 */
export function corsMiddleware(): RequestHandler {
  const allowlist = new Set([
    ...config.corsOrigins,
    ...(config.isProduction ? [] : DEV_ORIGINS),
  ]);

  const options: CorsOptions = {
    origin(origin, callback) {
      if (!origin || allowlist.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };

  return cors(options);
}

/** Security headers. CSP is relaxed for the bundled SPA assets. */
export function helmetMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });
}

/** Global rate limiter applied to all API routes. */
export function globalRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
}

/** Stricter rate limiter for sensitive endpoints (auth, setup). */
export function authRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.authRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later.' },
  });
}

/** 404 handler for unknown API routes. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

/**
 * Centralized error handler. Never leaks internal stack traces to clients;
 * full details are logged server-side only.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;

  // Log full error server-side for diagnostics.
  // eslint-disable-next-line no-console
  console.error('[error]', err);

  const safeMessage =
    status < 500 && typeof err?.message === 'string'
      ? err.message
      : 'Internal server error';

  res.status(status).json({ error: safeMessage });
};
