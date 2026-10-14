import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import type { LoginInput, RegisterInput, PublicUser } from '@snapshare/contracts';
import { authRepository as repo } from './repository.js';
import { AppError } from '../../middleware/errors.js';
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const safeUser = (user: { _id: { toString(): string }; name: string; email: string }): PublicUser => ({ id: user._id.toString(), name: user.name, email: user.email });
// A cached dummy hash makes unknown-email logins perform the same expensive verification.
let dummyHash: Promise<string> | undefined;
const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
export function createAuthService(sessionDays: number) {
  async function issueSession(user: { _id: { toString(): string }; name: string; email: string }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionDays * 86400000);
    await repo.createSession(user._id.toString(), hashToken(token), expiresAt);
    return { user: safeUser(user), token, expiresAt };
  }
  return {
    async register(input: RegisterInput) {
      const passwordHash = await hashPassword(input.password);
      let user;
      try { user = await repo.createUser({ ...input, passwordHash }); }
      catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) throw new AppError(409, 'Unable to register this email');
        throw error;
      }
      try { return await issueSession(user); }
      catch (error) { await repo.deleteUser(user._id.toString()); throw error; }
    },
    async login(input: LoginInput) {
      const user = await repo.findByEmail(input.email);
      dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
      const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, input.password);
      if (!user || !valid) throw new AppError(401, 'Invalid email or password');
      return issueSession(user);
    },
    async current(token: string | undefined) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(401, 'Sign in required');
      const session = await repo.findSession(hashToken(token));
      if (!session) throw new AppError(401, 'Sign in required');
      const user = await repo.findUser(session.userId.toString());
      if (!user) throw new AppError(401, 'Sign in required');
      return safeUser(user);
    },
    async logout(token: string | undefined) { if (token) await repo.deleteSession(hashToken(token)); },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
