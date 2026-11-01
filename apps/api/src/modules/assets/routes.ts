import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env.js';
import type { Storage } from '../../infrastructure/storage.js';
import { createAuthService } from '../auth/service.js';
import { cookieName } from '../auth/controller.js';
import { createAssetService } from './service.js';
import { createAssetController } from './controller.js';
export function assetRoutes(env: Env, storage: Storage) {
  const router = Router(); const auth = createAuthService(env.SESSION_DAYS);
  router.use((req, _res, next) => /^\/(uploads|snippets)(\/|$)/.test(req.path) ? next() : next('router'));
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(async (req, res, next) => {
    const token: unknown = req.cookies?.[cookieName(env)];
    res.locals.ownerId = (await auth.current(typeof token === 'string' ? token : undefined)).id;
    next();
  });
  router.use(rateLimit({ windowMs: 60000, limit: 120, keyGenerator: (_req, res) => res.locals.ownerId as string, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many workspace requests; try again shortly' } }));
  const c = createAssetController(createAssetService(storage));
  router.get('/uploads', c.list); router.post('/uploads/initiate', c.initiate);
  router.get('/uploads/:id', c.get); router.post('/uploads/:id/parts', c.sign);
  router.post('/uploads/:id/complete', c.complete); router.delete('/uploads/:id', c.abort);
  router.get('/snippets', c.snippets); router.post('/snippets', c.createSnippet);
  return router;
}
