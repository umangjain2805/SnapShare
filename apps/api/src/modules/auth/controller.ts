import type { Request, Response, CookieOptions } from 'express';
import { loginSchema, registerSchema } from '@snapshare/contracts';
import type { AuthService } from './service.js';
import type { Env } from '../../config/env.js';
export const cookieName = (env: Env) => env.NODE_ENV === 'production' ? '__Host-snapshare_session' : 'snapshare_session';
export function createAuthController(service: AuthService, env: Env) {
  const options: CookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
  const token = (req: Request): string | undefined => {
    const value: unknown = req.cookies?.[cookieName(env)];
    return typeof value === 'string' ? value : undefined;
  };
  function respond(res: Response, result: Awaited<ReturnType<AuthService['login']>>, status: number) {
    res.cookie(cookieName(env), result.token, { ...options, expires: result.expiresAt });
    res.status(status).json({ user: result.user });
  }
  return {
    register: async (req: Request, res: Response) => respond(res, await service.register(registerSchema.parse(req.body)), 201),
    login: async (req: Request, res: Response) => respond(res, await service.login(loginSchema.parse(req.body)), 200),
    me: async (req: Request, res: Response) => { res.json({ user: await service.current(token(req)) }); },
    logout: async (req: Request, res: Response) => {
      await service.logout(token(req)); res.clearCookie(cookieName(env), options); res.sendStatus(204);
    },
  };
}
