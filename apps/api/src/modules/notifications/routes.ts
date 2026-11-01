import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env.js';
import { createAuthService } from '../auth/service.js';
import { cookieName } from '../auth/controller.js';
import { createNotificationController } from './controller.js';
export function notificationRoutes(env: Env) {
  const router = Router(); const auth = createAuthService(env.SESSION_DAYS); const c = createNotificationController();
  router.use((req, _res, next) => /^\/me\/notifications(\/|$)/.test(req.path) ? next() : next('router'));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(async (req, res, next) => { const token: unknown = req.cookies?.[cookieName(env)]; res.locals.ownerId = (await auth.current(typeof token === 'string' ? token : undefined)).id; next(); });
  router.use(rateLimit({ windowMs: 60000, limit: 120, keyGenerator: (_req, res) => res.locals.ownerId as string, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many notification requests. Try again shortly.' } }));
  router.get('/me/notifications', c.list); router.post('/me/notifications/:id/read', c.read);
  return router;
}
