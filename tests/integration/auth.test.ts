import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import argon2 from 'argon2';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../../apps/api/src/infrastructure/database.js';
import { User, Session } from '../../apps/api/src/modules/auth/model.js';
import { hashToken } from '../../apps/api/src/modules/auth/service.js';
import { createStorage } from '../../packages/backend/src/storage.js';
let mongo: MongoMemoryReplSet;
const origin = 'http://localhost:5173';
const env = parseEnv({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/test', LOG_LEVEL: 'silent', APP_URL: origin });
let app: ReturnType<typeof createApp>;
const input = { name: 'Alex Morgan', email: 'alex@example.com', password: 'a-unique-long-passphrase' };
function post(path: string, body: object = input) { return request(app).post(path).set('Origin', origin).send(body); }
function getCookie(response: request.Response) {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header[0]!.split(';')[0]!;
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), Session.init()]);
});
beforeEach(async () => { await Promise.all([User.deleteMany({}), Session.deleteMany({})]); app = createApp(env); });
afterAll(async () => { await disconnectDatabase(); await mongo?.stop(); });
describe('account sessions on a real MongoDB replica set', () => {
  it('returns uncached generic health and database-backed readiness', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.headers['cache-control']).toBe('no-store');
    const unavailable = createApp({ ...env, S3_BUCKET: 'private-bucket' }, { ...createStorage(env), assertConfigured() { throw new Error('private dependency details'); } });
    const failed = await request(unavailable).get('/api/ready');
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ status: 'unavailable' });
  });
  it('registers, stores only hashed secrets, returns safe user data and logs out', async () => {
    const registered = await post('/api/auth/register');
    expect(registered.status).toBe(201);
    expect(registered.body.user).toEqual({ id: expect.any(String), name: input.name, email: input.email });
    const cookie = getCookie(registered);
    expect(registered.headers['set-cookie']![0]!).toContain('HttpOnly');
    expect(registered.headers['set-cookie']![0]!).toContain('SameSite=Lax');
    const user = await User.findOne().select('+passwordHash');
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(user!.passwordHash, input.password)).toBe(true);
    const session = await Session.findOne();
    expect(session?.tokenHash).toBe(hashToken(cookie.split('=')[1]!));
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200);
    expect((await post('/api/auth/logout', {}).set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect(await Session.countDocuments()).toBe(0);
  });
  it('logs in and normalizes email; rejects wrong passwords, unknown accounts and duplicates', async () => {
    await post('/api/auth/register');
    expect((await post('/api/auth/login', { email: 'ALEX@EXAMPLE.COM', password: input.password })).status).toBe(200);
    const wrong = await post('/api/auth/login', { email: input.email, password: 'incorrect' });
    const missing = await post('/api/auth/login', { email: 'unknown@example.com', password: 'incorrect' });
    expect(wrong.status).toBe(401); expect(missing.body).toEqual(wrong.body);
    expect((await post('/api/auth/register')).status).toBe(409);
  });
  it('rejects expired, forged and missing sessions at read time', async () => {
    const cookie = getCookie(await post('/api/auth/register'));
    await Session.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', 'snapshare_session=forged')).status).toBe(401);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });
  it('isolates two account sessions and revokes only the caller on logout', async () => {
    const a = getCookie(await post('/api/auth/register'));
    const b = getCookie(await post('/api/auth/register', { ...input, email: 'b@example.com', name: 'Bob' }));
    expect((await request(app).get('/api/auth/me').set('Cookie', b)).body.user.email).toBe('b@example.com');
    await post('/api/auth/logout', {}).set('Cookie', a);
    expect((await request(app).get('/api/auth/me').set('Cookie', b)).status).toBe(200);
  });
  it('rejects CSRF origins, missing origins, non-JSON and malformed or invalid input', async () => {
    expect((await request(app).post('/api/auth/register').send(input)).status).toBe(403);
    expect((await request(app).post('/api/auth/register').set('Origin', 'https://evil.example').send(input)).status).toBe(403);
    expect((await request(app).post('/api/auth/login').set('Origin', origin).type('form').send({ email: input.email })).status).toBe(415);
    expect((await post('/api/auth/register', { ...input, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').set('Origin', origin).type('json').send('{')).status).toBe(400);
  });
  it('rate limits repeated authentication attempts', async () => {
    for (let i = 0; i < 20; i++) expect((await post('/api/auth/login', {})).status).toBe(400);
    expect((await post('/api/auth/login', {})).status).toBe(429);
  });
  it('sets production cookie protections, no-store and security headers', async () => {
    app = createApp({ ...env, NODE_ENV: 'production', APP_URL: 'https://snapshare.example' });
    const result = await request(app).post('/api/auth/register').set('Origin', 'https://snapshare.example').send(input);
    expect(result.status).toBe(201);
    expect(result.headers['set-cookie']![0]!).toContain('__Host-snapshare_session=');
    expect(result.headers['set-cookie']![0]!).toContain('Secure');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['x-powered-by']).toBeUndefined();
  });
  it('exposes liveness and readiness without account or infrastructure secrets', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/api/ready')).status).toBe(200);
    expect((await request(app).get('/api/missing')).status).toBe(404);
  });
});
