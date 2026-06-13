import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cookieParser from 'cookie-parser';
import express from 'express';

import { config } from './config/index.js';
import db from './database.js';
import { getAppSecret } from './lib/appSecret.js';
import { optionalAuth, requireAuth } from './middleware/auth.js';
import {
  corsMiddleware,
  errorHandler,
  globalRateLimiter,
  helmetMiddleware,
  notFoundHandler,
} from './middleware/security.js';
import { ensureSetupToken } from './services/setup-service.js';
import articlesRouter from './routes/articles.js';
import authRouter from './routes/auth.js';
import dashboardRouter from './routes/dashboard.js';
import exportRouter from './routes/export.js';
import generatorRouter from './routes/generator.js';
import projectsRouter from './routes/projects.js';
import promptsRouter from './routes/prompts.js';
import settingsRouter from './routes/settings.js';
import setupRouter from './routes/setup.js';
import templatesRouter from './routes/templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the app secret exists (generated & persisted on first boot).
getAppSecret();

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// ── Security middleware ──
app.use(helmetMiddleware());
app.use(corsMiddleware());
app.use(express.json({ limit: config.bodyLimit }));
app.use(cookieParser());
app.use('/api', globalRateLimiter());
app.use(optionalAuth);

// ── Health check (public) ──
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, uptime: process.uptime(), db: 'ok' });
  } catch {
    res.status(503).json({ ok: false, uptime: process.uptime(), db: 'error' });
  }
});

// ── Public routes: setup + auth ──
app.use('/api/setup', setupRouter);
app.use('/api/auth', authRouter);

// ── Protected routes (admin session required) ──
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/articles', requireAuth, articlesRouter);
app.use('/api/generate', requireAuth, generatorRouter);
app.use('/api/prompts', requireAuth, promptsRouter);
app.use('/api/templates', requireAuth, templatesRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/export', requireAuth, exportRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);

// Unknown API routes -> JSON 404 (before the SPA catch-all).
app.use('/api', notFoundHandler);

// ── Serve the built SPA in production ──
if (config.isProduction) {
  const distPath = path.join(__dirname, '..', 'dist');
  const indexHtml = path.join(distPath, 'index.html');

  if (!fs.existsSync(indexHtml)) {
    // eslint-disable-next-line no-console
    console.error(
      `[startup] Built frontend not found at ${distPath}. ` +
        'Run "npm run build" (the Dockerfile build stage does this automatically).',
    );
  }

  // Serve hashed static assets with correct MIME types and long-lived caching.
  app.use(express.static(distPath, { index: false, maxAge: '1y' }));

  // SPA fallback. Only serve index.html for navigation-style requests. A request
  // for a missing file (it has an extension, e.g. a stale /assets/*.css|js hash)
  // must return a real 404 — never index.html — so the browser does not receive
  // HTML where it expects a stylesheet/script (the "wrong MIME type" error).
  app.get('*', (req, res, next) => {
    if (path.extname(req.path)) {
      res.status(404).end();
      return;
    }
    res.sendFile(indexHtml, (err) => {
      if (err) next(err);
    });
  });
}

// Centralized error handler (keeps stack traces server-side only).
app.use(errorHandler);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`ArticleWriterPro server running on http://localhost:${config.port}`);
  // Print the first-run setup URL/token when setup is required.
  ensureSetupToken();
});

export default app;
