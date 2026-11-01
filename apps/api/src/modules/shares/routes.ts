import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env.js';
import type { Storage } from '../../infrastructure/storage.js';
import { createAuthService } from '../auth/service.js';
import { cookieName } from '../auth/controller.js';
import { createShareService } from './service.js';
import { createShareController } from './controller.js';
export function shareRoutes(env: Env, storage: Storage) {
  const router = Router();
  router.use((req, _res, next) => /^\/(shares|transfers|me\/shares)(\/|$)/.test(req.path) ? next() : next('router'));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
  const c = createShareController(createShareService(storage), env.APP_URL);
  const publicLimit = rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many access attempts. Try again later.' } });
  const transferLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many transfer requests. Try again later.' } });
  router.get('/shares/:token', publicLimit, c.metadata);
  router.post('/shares/:token/claim', publicLimit, c.claim);
  router.head('/transfers/:ticket', (_req, res) => { res.setHeader('Allow', 'GET'); res.sendStatus(405); });
  router.get('/transfers/:ticket', transferLimit, c.transfer);
  const auth = createAuthService(env.SESSION_DAYS);
  router.use(async (req, res, next) => { const token: unknown = req.cookies?.[cookieName(env)]; res.locals.ownerId = (await auth.current(typeof token === 'string' ? token : undefined)).id; next(); });
  router.use(rateLimit({ windowMs: 60000, limit: 30, keyGenerator: (_req, res) => res.locals.ownerId as string, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many share management requests. Try again shortly.' } }));
  router.post('/shares', c.create); router.get('/me/shares', c.list); router.delete('/me/shares/:id', c.revoke);
  return router;
}
