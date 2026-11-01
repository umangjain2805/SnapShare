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
  it('fails closed for incomplete production infrastructure and unsafe proxy settings', () => {
    const production = { NODE_ENV: 'production', APP_URL: 'https://share.example.com', MONGODB_URI: 'mongodb://localhost/db', S3_BUCKET: 'private-bucket', REDIS_URL: 'rediss://redis.example.com:6379' };
    expect(parseEnv(production).NODE_ENV).toBe('production');
    for (const override of [{ S3_BUCKET: '' }, { REDIS_URL: 'redis://localhost:6379' }, { S3_ENDPOINT: 'http://localhost:9000' }, { LOG_LEVEL: 'debug' }, { TRUSTED_PROXIES: 'true' }, { TRUSTED_PROXIES: '0.0.0.0/0' }, { TRUSTED_PROXIES: '999.1.1.1' }]) {
      expect(() => parseEnv({ ...production, ...override })).toThrow();
    }
    expect(parseEnv({ ...production, TRUSTED_PROXIES: '10.0.1.0/24,127.0.0.1' }).TRUSTED_PROXIES).toContain('/24');
  });
});
