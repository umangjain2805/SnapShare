import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { PART_SIZE } from '../../packages/contracts/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../../apps/api/src/infrastructure/database.js';
import type { Storage, StoredPart } from '../../apps/api/src/infrastructure/storage.js';
import { UploadSession, Snippet, AssetQuota } from '../../apps/api/src/modules/assets/model.js';
import { User, Session } from '../../apps/api/src/modules/auth/model.js';
const origin = 'http://localhost:5173';
const env = parseEnv({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/test', LOG_LEVEL: 'silent' });
const input = { filename: 'example.txt', size: PART_SIZE + 5, mimeType: 'text/plain', fingerprint: 'a'.repeat(64) };
let mongo: MongoMemoryReplSet; let app: ReturnType<typeof createApp>; let cookie: string; let other: string;
let parts: StoredPart[]; let object: { size: number; mimeType: string } | null;
let abortFails = false; let lostResponse = false; let completed = 0;
const storage: Storage = {
  async begin() { return 'private-storage-upload-id'; },
  async sign(_key, _id, part, size) { return `https://private.test/part/${part}?size=${size}`; },
  async parts() { return parts; },
  async complete() { completed++; object = { size: input.size, mimeType: input.mimeType }; if (lostResponse) throw new Error('Response lost'); },
  async head() { return object; },
  async abort() { if (abortFails) throw new Error('Storage offline'); },
};
function post(path: string, body: object = {}, auth = cookie) { return request(app).post(`/api${path}`).set('Origin', origin).set('Cookie', auth).send(body); }
function get(path: string, auth = cookie) { return request(app).get(`/api${path}`).set('Cookie', auth); }
function abort(id: string, auth = cookie) { return request(app).delete(`/api/uploads/${id}`).set('Origin', origin).set('Cookie', auth).send({}); }
async function initiate() { const result = await post('/uploads/initiate', input); expect(result.status).toBe(201); return result.body.upload.id as string; }
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), Session.init(), UploadSession.init(), Snippet.init(), AssetQuota.init()]);
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Session.deleteMany({}), UploadSession.deleteMany({}), Snippet.deleteMany({}), AssetQuota.deleteMany({})]);
  app = createApp(env, storage); parts = []; object = null; abortFails = false; lostResponse = false; completed = 0;
  async function register(email: string) {
    const result = await request(app).post('/api/auth/register').set('Origin', origin).send({ name: 'Test Owner', email, password: 'a-strong-test-passphrase' });
    return String(result.headers['set-cookie']![0]).split(';')[0]!;
  }
  cookie = await register('owner@example.com'); other = await register('other@example.com');
});
afterAll(async () => { await disconnectDatabase(); await mongo?.stop(); });
it('authenticates every asset route and protects ownership without revealing keys', async () => {
  expect((await request(app).get('/api/uploads')).status).toBe(401);
  expect((await request(app).post('/api/uploads/initiate').set('Origin', origin).send(input)).status).toBe(401);
  expect((await request(app).get('/api/snippets')).status).toBe(401);
  const id = await initiate();
  expect((await get(`/uploads/${id}`, other)).status).toBe(404);
  expect((await post(`/uploads/${id}/parts`, { partNumber: 1 }, other)).status).toBe(404);
  expect((await post(`/uploads/${id}/complete`, {}, other)).status).toBe(404);
  expect((await abort(id, other)).status).toBe(404);
  expect((await get('/uploads', other)).body.uploads).toEqual([]);
  expect((await get('/uploads')).text).not.toMatch(/objectKey|storageUploadId|private-storage-upload-id/);
  expect((await get('/uploads/not-an-id')).status).toBe(404);
});
it('validates file metadata and scopes part signing to declared size', async () => {
  for (const change of [{ size: 0 }, { size: 256 * 1024 * 1024 + 1 }, { mimeType: 'text/html' }, { filename: '../escape.txt' }, { fingerprint: 'bad' }, { objectKey: 'client-key' }]) expect((await post('/uploads/initiate', { ...input, ...change })).status).toBe(400);
  expect(await UploadSession.countDocuments()).toBe(0);
  const id = await initiate();
  expect((await post(`/uploads/${id}/parts`, { partNumber: 2 })).body.url).toContain('size=5');
  expect((await post(`/uploads/${id}/parts`, { partNumber: 3 })).status).toBe(400);
  expect((await post(`/uploads/${id}/parts`, { partNumber: 0 })).status).toBe(400);
  const record = await UploadSession.findById(id);
  expect(record!.objectKey).toMatch(/^quarantine\/[^/]+\/[a-f0-9-]+$/);
});
it('lists completed parts for resume and refuses incomplete or incorrectly sized uploads', async () => {
  const id = await initiate(); parts = [{ partNumber: 1, size: PART_SIZE, etag: 'etag-one' }];
  expect((await get(`/uploads/${id}`)).body.upload.parts).toEqual(parts);
  expect((await post(`/uploads/${id}/complete`)).status).toBe(409);
  parts.push({ partNumber: 2, size: 6, etag: 'wrong-size' });
  expect((await post(`/uploads/${id}/complete`)).status).toBe(409);
  expect(completed).toBe(0);
  parts[1]!.size = 5;
  const result = await post(`/uploads/${id}/complete`);
  expect(result.status).toBe(200); expect(result.body.upload.status).toBe('quarantined'); expect(result.body.upload.scanStatus).toBe('pending');
  expect((await post(`/uploads/${id}/complete`)).status).toBe(200); expect(completed).toBe(1);
  expect((await post(`/uploads/${id}/parts`, { partNumber: 1 })).status).toBe(409);
  expect((await abort(id)).status).toBe(409);
});
it('recovers completion after a lost S3 response or database persistence failure', async () => {
  const id = await initiate(); parts = [{ partNumber: 1, size: PART_SIZE, etag: 'one' }, { partNumber: 2, size: 5, etag: 'two' }]; lostResponse = true;
  expect((await post(`/uploads/${id}/complete`)).status).toBe(200);
  await UploadSession.updateOne({ _id: id }, { status: 'completing' });
  expect((await post(`/uploads/${id}/complete`)).status).toBe(200); expect(completed).toBe(1);
});
it('does not verify an object with incorrect size or MIME metadata', async () => {
  const id = await initiate(); await UploadSession.updateOne({ _id: id }, { status: 'completing' });
  object = { size: 1, mimeType: input.mimeType };
  expect((await post(`/uploads/${id}/complete`)).status).toBe(409);
  object = { size: input.size, mimeType: 'text/html' };
  expect((await post(`/uploads/${id}/complete`)).status).toBe(409);
  expect((await UploadSession.findById(id))!.status).toBe('completing');
});
it('rejects expired sessions at read time, retains metadata, and supports retryable abort', async () => {
  const id = await initiate(); await UploadSession.updateOne({ _id: id }, { expiresAt: new Date(Date.now() - 1000) });
  expect((await post(`/uploads/${id}/parts`, { partNumber: 1 })).status).toBe(410);
  expect((await post(`/uploads/${id}/complete`)).status).toBe(410);
  abortFails = true; expect((await abort(id)).status).toBe(500);
  expect((await UploadSession.findById(id))!.status).toBe('aborting');
  expect((await AssetQuota.findOne())!.bytes).toBe(input.size);
  abortFails = false; expect((await abort(id)).status).toBe(204); expect((await abort(id)).status).toBe(204);
  expect((await AssetQuota.findOne())!.bytes).toBe(0); expect((await AssetQuota.findOne())!.items).toBe(0);
  expect(await UploadSession.countDocuments()).toBe(1);
});
it('serializes concurrent quota reservations and releases quota once during competing aborts', async () => {
  const ownerId = (await get('/auth/me')).body.user.id as string;
  await AssetQuota.create({ _id: ownerId, bytes: 1024 * 1024 * 1024 - input.size, items: 99 });
  const results = await Promise.all([post('/uploads/initiate', input), post('/uploads/initiate', input)]);
  expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  const id = results.find(r => r.status === 201)!.body.upload.id as string;
  await Promise.all([abort(id), abort(id)]);
  const quota = await AssetQuota.findById(ownerId);
  expect(quota!.bytes).toBe(1024 * 1024 * 1024 - input.size); expect(quota!.items).toBe(99);
});
it('stores snippets as inert text, enforces UTF-8 size limits, and isolates owners', async () => {
  const snippet = { title: 'Unsafe example', language: 'markup', text: '<script>window.pwned=true</script><img src=x onerror=alert(1)>' };
  const result = await post('/snippets', snippet); expect(result.status).toBe(201); expect(result.body.snippet.text).toBe(snippet.text);
  expect((await get('/snippets', other)).body.snippets).toEqual([]);
  expect((await get('/snippets')).body.snippets).toHaveLength(1);
  expect((await post('/snippets', { ...snippet, language: 'executable' })).status).toBe(400);
  expect((await post('/snippets', { ...snippet, text: '🎉'.repeat(9000) })).status).toBe(400);
  expect((await post('/snippets', { ...snippet, text: '' })).status).toBe(400);
  expect((await get('/snippets')).headers['cache-control']).toBe('no-store');
});
it('accepts the snippet byte limit even when JSON escaping expands its wire size', async () => {
  const snippet = { title: 'Escaped text', language: 'plaintext', text: '\u0001'.repeat(32768) };
  const result = await post('/snippets', snippet);
  expect(result.status).toBe(201); expect(result.body.snippet.text).toBe(snippet.text);
  expect((await post('/snippets', { ...snippet, text: snippet.text + 'x' })).status).toBe(400);
});
