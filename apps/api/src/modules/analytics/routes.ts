import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env.js';
import { createAuthService } from '../auth/service.js';
import { cookieName } from '../auth/controller.js';
import { createAnalyticsController } from './controller.js';
export function analyticsRoutes(env: Env) {
  const router = Router(); const auth = createAuthService(env.SESSION_DAYS); const c = createAnalyticsController();
  router.use((req, _res, next) => req.path === '/me/analytics' ? next() : next('router'));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(async (req, res, next) => { const token: unknown = req.cookies?.[cookieName(env)]; res.locals.ownerId = (await auth.current(typeof token === 'string' ? token : undefined)).id; next(); });
  router.get('/me/analytics', rateLimit({ windowMs: 60000, limit: 60, keyGenerator: (_req, res) => res.locals.ownerId as string, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many analytics requests. Try again shortly.' } }), c.get);
  return router;
}
