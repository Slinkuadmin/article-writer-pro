import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { config } from './config/index.js';
import db from './database.js';
import { getAppSecret } from './lib/appSecret.js';
import {
  corsMiddleware,
  errorHandler,
  globalRateLimiter,
  helmetMiddleware,
  notFoundHandler,
} from './middleware/security.js';
import articlesRouter from './routes/articles.js';
import dashboardRouter from './routes/dashboard.js';
import exportRouter from './routes/export.js';
import generatorRouter from './routes/generator.js';
import projectsRouter from './routes/projects.js';
import promptsRouter from './routes/prompts.js';
import settingsRouter from './routes/settings.js';
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
app.use('/api', globalRateLimiter());

// ── Health check ──
app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, uptime: process.uptime(), db: 'ok' });
  } catch (err) {
    res.status(503).json({ ok: false, uptime: process.uptime(), db: 'error' });
  }
});

// ── API routes ──
app.use('/api/projects', projectsRouter);
app.use('/api/articles', articlesRouter);
app.use('/api/generate', generatorRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/export', exportRouter);
app.use('/api/dashboard', dashboardRouter);

// Unknown API routes -> JSON 404 (must be before the SPA catch-all).
app.use('/api', notFoundHandler);

// ── Serve the built SPA in production ──
if (config.isProduction) {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Centralized error handler (keeps stack traces server-side only).
app.use(errorHandler);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`ArticleWriterPro server running on http://localhost:${config.port}`);
});

export default app;
