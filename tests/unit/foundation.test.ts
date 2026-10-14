import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../../packages/contracts/src/index.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { hashToken } from '../../apps/api/src/modules/auth/service.js';
describe('foundation contracts', () => {
  it('normalizes email and rejects weak passwords and extra properties', () => {
    expect(loginSchema.parse({ email: 'USER@EXAMPLE.COM', password: 'password' }).email).toBe('user@example.com');
    expect(registerSchema.safeParse({ name: 'Alex', email: 'a@example.com', password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'Alex', email: 'a@example.com', password: 'a-long-passphrase', admin: true }).success).toBe(false);
  });
  it('requires a database and HTTPS in production', () => {
    expect(() => parseEnv({})).toThrow();
    expect(() => parseEnv({ MONGODB_URI: 'mongodb://localhost/db', NODE_ENV: 'production' })).toThrow();
    expect(() => parseEnv({ MONGODB_URI: 'mongodb://localhost/db', APP_URL: 'http://localhost:5173/path' })).toThrow();
  });
  it('hashes tokens deterministically without retaining the raw secret', () => {
    expect(hashToken('secret')).toHaveLength(64);
    expect(hashToken('secret')).not.toBe('secret');
    expect(hashToken('secret')).not.toBe(hashToken('another-secret'));
  });
});
