import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { Env } from './config/env.js';
import { createLogger } from './infrastructure/logger.js';
import { AppError, errorHandler } from './middleware/errors.js';
import { authRoutes } from './modules/auth/routes.js';
export function createApp(env: Env) {
  const app = express();
  const logger = createLogger(env.LOG_LEVEL);
  app.disable('x-powered-by');
  // Proxy trust remains disabled until a known deployment topology is configured.
  app.use(helmet());
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => logger.info({ requestId, method: req.method, status: res.statusCode }, 'request'));
    next();
  });
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use((req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      // CORS alone is not CSRF protection. Require exact Origin + JSON for mutations.
      if (req.get('origin') !== env.APP_URL) return next(new AppError(403, 'Origin not allowed'));
      if (!req.is('application/json')) return next(new AppError(415, 'Use application/json'));
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });
  app.use('/api/auth', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, authRoutes(env));
  app.use((_req, _res, next) => next(new AppError(404, 'Route not found')));
  app.use(errorHandler(logger));
  return app;
}
