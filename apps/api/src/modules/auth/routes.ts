import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env.js';
import { createAuthService } from './service.js';
import { createAuthController } from './controller.js';
export function authRoutes(env: Env) {
  const router = Router();
  const controller = createAuthController(createAuthService(env.SESSION_DAYS), env);
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });
  router.post('/register', limiter, controller.register);
  router.post('/login', limiter, controller.login);
  router.post('/logout', controller.logout);
  router.get('/me', controller.me);
  return router;
}
