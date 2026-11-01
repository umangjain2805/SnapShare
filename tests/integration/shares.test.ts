import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../../apps/api/src/infrastructure/database.js';
import type { Storage } from '../../apps/api/src/infrastructure/storage.js';
import { User, Session } from '../../apps/api/src/modules/auth/model.js';
import { Snippet, UploadSession } from '../../apps/api/src/modules/assets/model.js';
import { Share, TransferTicket, OutboxEvent } from '../../apps/api/src/modules/shares/model.js';
import { hashToken } from '../../apps/api/src/modules/auth/service.js';
const origin = 'http://localhost:5173'; const password = 'one-time-share-password';
const env = parseEnv({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/test', LOG_LEVEL: 'silent' });
let mongo: MongoMemoryReplSet; let app: ReturnType<typeof createApp>; let cookie: string; let other: string; let ownerId: string; let sourceId: string;
let openFails = false; let streamFails = false; let shortStream = false;
const storage: Storage = {
  async begin() { return 'unused'; }, async sign() { return 'unused'; }, async parts() { return []; }, async complete() {}, async head() { return null; }, async abort() {},
  async open() {
    if (openFails) throw new Error('Storage connection lost');
    if (streamFails) return Readable.from((async function* () { yield Buffer.from('x'); throw new Error('Storage read interrupted'); })());
    return Readable.from([Buffer.from(shortStream ? 'x' : 'private bytes')]);
  },
};
function post(path: string, body: object, auth = '') { return request(app).post(`/api${path}`).set('Origin', origin).set('Cookie', auth).send(body); }
function get(path: string, auth = '') { return request(app).get(`/api${path}`).set('Cookie', auth); }
const nonce = () => randomBytes(32).toString('base64url');
async function create(sourceType = 'snippet', id = sourceId, auth = cookie) {
  return post('/shares', { sourceType, sourceId: id, password }, auth);
}
async function newToken() { const result = await create(); expect(result.status).toBe(201); return String(result.body.share.url).split('/').at(-1)!; }
async function claim(token: string, idempotencyKey = nonce()) { return post(`/shares/${token}/claim`, { password, idempotencyKey }); }
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } }); await connectDatabase(mongo.getUri());
  await Promise.all([User.init(), Session.init(), Snippet.init(), UploadSession.init(), Share.init(), TransferTicket.init(), OutboxEvent.init()]);
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([User.deleteMany({}), Session.deleteMany({}), Snippet.deleteMany({}), UploadSession.deleteMany({}), Share.deleteMany({}), TransferTicket.deleteMany({}), OutboxEvent.deleteMany({})]);
  app = createApp(env, storage); openFails = false; streamFails = false; shortStream = false;
  async function register(email: string) {
    return post('/auth/register', { name: 'Test Owner', email, password: 'account-test-passphrase' });
  }
  const registered = await register('owner@example.com'); ownerId = registered.body.user.id as string;
  cookie = String(registered.headers['set-cookie']![0]).split(';')[0]!;
  other = String((await register('other@example.com')).headers['set-cookie']![0]).split(';')[0]!;
  const snippet = await Snippet.create({ ownerId, title: 'Private example', language: 'markup', text: '<script>alert(1)</script>' }); sourceId = snippet.id as string;
});
afterAll(async () => { vi.restoreAllMocks(); await disconnectDatabase(); await mongo?.stop(); });
it('uses fixed defaults and hashes bearer tokens/passwords without returning raw secrets in owner listings', async () => {
  const before = Date.now(); const token = await newToken(); const share = await Share.findOne().select('+passwordHash');
  expect(share!.tokenHash).toBe(hashToken(token)); expect(share!.passwordHash).toMatch(/^\$argon2id\$/);
  expect(share!.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 86400000);
  expect(share!.expiresAt.getTime() - share!.createdAt.getTime()).toBe(86400000);
  expect(share!.maxDownloads).toBe(1); expect(share!.downloadCount).toBe(0); expect(share!.notificationsEnabled).toBe(true);
  const list = await get('/me/shares', cookie); expect(list.body.shares).toHaveLength(1);
  expect(list.text).not.toContain(token); expect(list.text).not.toMatch(/passwordHash|tokenHash|objectKey/);
  expect((await create('snippet', sourceId, other)).status).toBe(404);
  expect((await create('snippet', sourceId, '')).status).toBe(401);
  expect((await post('/shares', { sourceType: 'snippet', sourceId, password, maxDownloads: 2 }, cookie)).status).toBe(400);
});
it('hides private metadata and normalizes wrong-password and missing-share failures', async () => {
  const token = await newToken(); const missing = nonce();
  const known = await get(`/shares/${token}`); const unknown = await get(`/shares/${missing}`);
  expect(known.body).toEqual(unknown.body); expect(known.text).not.toMatch(/Private|owner|snippet|text/);
  const wrong = await post(`/shares/${token}/claim`, { password: 'wrong', idempotencyKey: nonce() });
  const absent = await claim(missing);
  expect(wrong.status).toBe(403); expect(absent.status).toBe(wrong.status); expect(absent.body).toEqual(wrong.body);
  expect(await TransferTicket.countDocuments()).toBe(0); expect(await OutboxEvent.countDocuments()).toBe(0);
});
it('commits exactly one claim, one ticket and one outbox event for 20 simultaneous contenders', async () => {
  const token = await newToken();
  const results = await Promise.all(Array.from({ length: 20 }, () => claim(token)));
  expect(results.filter(r => r.status === 200)).toHaveLength(1); expect(results.filter(r => r.status === 410)).toHaveLength(19);
  expect((await Share.findOne())!.downloadCount).toBe(1); expect((await Share.findOne())!.status).toBe('claimed');
  expect(await TransferTicket.countDocuments()).toBe(1); expect(await OutboxEvent.countDocuments()).toBe(1);
  expect((await OutboxEvent.findOne())!.status).toBe('pending');
});
it('retries a lost claim response with the same ticket and refuses a different key or a redeemed ticket', async () => {
  const token = await newToken(); const key = nonce(); const first = await claim(token, key);
  const second = await claim(token, key); expect(second.status).toBe(200); expect(second.body).toEqual(first.body);
  const ticket = await TransferTicket.findOne(); expect(ticket!.tokenHash).toBe(hashToken(first.body.ticket as string)); expect(ticket!.claimHash).toBe(hashToken(key));
  expect(JSON.stringify(ticket)).not.toContain(key); expect(JSON.stringify(ticket)).not.toContain(first.body.ticket as string);
  expect((await claim(token)).status).toBe(410);
  const bytes = await get(`/transfers/${first.body.ticket}`); expect(bytes.status).toBe(200);
  expect(bytes.headers['content-disposition']).toContain('attachment'); expect(bytes.headers['content-type']).toContain('application/octet-stream');
  expect(bytes.headers['cache-control']).toBe('no-store'); expect(bytes.headers['x-content-type-options']).toBe('nosniff');
  expect(Buffer.from(bytes.body as Uint8Array).toString()).toBe('<script>alert(1)</script>');
  await vi.waitFor(async () => expect((await TransferTicket.findOne())!.delivery).toBe('finished'));
  expect((await claim(token, key)).status).toBe(410); expect((await get(`/transfers/${first.body.ticket}`)).status).toBe(410);
  expect(await OutboxEvent.countDocuments()).toBe(1);
});
it('serializes two redemptions and does not consume tickets on HEAD or Range requests', async () => {
  const token = await newToken(); const result = await claim(token); const path = `/transfers/${result.body.ticket}`;
  expect((await request(app).head(`/api${path}`)).status).toBe(405);
  expect((await get(path).set('Range', 'bytes=0-1')).status).toBe(416);
  expect((await TransferTicket.findOne())!.status).toBe('issued');
  const attempts = await Promise.all([get(path), get(path)]); expect(attempts.map(r => r.status).sort()).toEqual([200, 410]);
});
it('checks share and ticket expiration immediately without deleting cleanup metadata', async () => {
  const token = await newToken(); await Share.updateMany({}, { expiresAt: new Date(Date.now() - 1) });
  expect((await claim(token)).status).toBe(410); expect(await TransferTicket.countDocuments()).toBe(0);
  const next = await newToken(); const result = await claim(next); await TransferTicket.updateMany({}, { startBefore: new Date(Date.now() - 1) });
  expect((await get(`/transfers/${result.body.ticket}`)).status).toBe(410); expect(await Share.countDocuments()).toBe(2); expect(await TransferTicket.countDocuments()).toBe(1);
});
it('protects management ownership and invalidates an issued ticket on revocation', async () => {
  const token = await newToken(); const share = await Share.findOne(); const result = await claim(token);
  const revoke = (auth: string) => request(app).delete(`/api/me/shares/${share!.id}`).set('Origin', origin).set('Cookie', auth).send({});
  expect((await revoke(other)).status).toBe(404); expect((await get('/me/shares', other)).body.shares).toEqual([]);
  expect((await revoke(cookie)).status).toBe(204); expect((await get(`/transfers/${result.body.ticket}`)).status).toBe(410);
  expect((await TransferTicket.findOne())!.status).toBe('issued'); expect((await claim(token)).status).toBe(410);
});
it('rolls back the share and ticket if writing the outbox fails', async () => {
  const token = await newToken(); const spy = vi.spyOn(OutboxEvent, 'create').mockRejectedValueOnce(new Error('Outbox write failed'));
  expect((await claim(token)).status).toBe(500); spy.mockRestore();
  expect((await Share.findOne())!.downloadCount).toBe(0); expect((await Share.findOne())!.status).toBe('active');
  expect(await TransferTicket.countDocuments()).toBe(0); expect(await OutboxEvent.countDocuments()).toBe(0);
  expect((await claim(token)).status).toBe(200);
});
async function fileToken(scanStatus = 'clean') {
  const upload = await UploadSession.create({ ownerId, filename: 'private-file.txt', size: 13, mimeType: 'text/plain', fingerprint: 'a'.repeat(64), objectKey: `quarantine/${ownerId}/${nonce()}`, status: 'quarantined', scanStatus, expiresAt: new Date(Date.now() + 86400000) });
  return create('upload', upload.id as string);
}
it('blocks quarantined/rejected files, requires a trusted clean result and streams private bytes', async () => {
  expect((await fileToken('pending')).status).toBe(409); expect((await fileToken('rejected')).status).toBe(409);
  const shared = await fileToken(); expect(shared.status).toBe(201); const token = String(shared.body.share.url).split('/').at(-1)!;
  const result = await claim(token); const download = await get(`/transfers/${result.body.ticket}`);
  expect(download.status).toBe(200); expect(Buffer.from(download.body as Uint8Array).toString()).toBe('private bytes');
  expect(download.headers.location).toBeUndefined(); expect(download.headers['content-disposition']).toContain('private-file.txt');
});
it('keeps a claim consumed after storage lookup failure and records transfer failure', async () => {
  const shared = await fileToken(); const token = String(shared.body.share.url).split('/').at(-1)!; const result = await claim(token);
  openFails = true; expect((await get(`/transfers/${result.body.ticket}`)).status).toBe(500);
  expect((await TransferTicket.findOne())!.status).toBe('redeemed'); expect((await TransferTicket.findOne())!.delivery).toBe('failed');
  openFails = false; expect((await get(`/transfers/${result.body.ticket}`)).status).toBe(410); expect((await claim(token)).status).toBe(410);
});
it('does not reauthorize failed or truncated streams', async () => {
  for (const fail of ['error', 'short']) {
    const shared = await fileToken(); const token = String(shared.body.share.url).split('/').at(-1)!; const result = await claim(token);
    streamFails = fail === 'error'; shortStream = fail === 'short';
    await get(`/transfers/${result.body.ticket}`).then(() => {}, () => {});
    // The server closes the connection on a stream error; wait for its failure bookkeeping.
    await vi.waitFor(async () => expect((await TransferTicket.findOne({ tokenHash: hashToken(result.body.ticket as string) }))!.delivery).toBe('failed'));
    expect((await get(`/transfers/${result.body.ticket}`)).status).toBe(410);
  }
});
it('rate limits public access attempts and enforces mutation origin/JSON', async () => {
  for (let i = 0; i < 40; i++) expect((await get(`/shares/${nonce()}`)).status).toBe(200);
  expect((await get(`/shares/${nonce()}`)).status).toBe(429);
  expect((await request(app).post('/api/shares').set('Cookie', cookie).send({})).status).toBe(403);
});
it('recovers simultaneous retries using one idempotency key without moving its start deadline', async () => {
  const token = await newToken(); const key = nonce();
  const responses = await Promise.all(Array.from({ length: 5 }, () => claim(token, key)));
  expect(responses.every(r => r.status === 200)).toBe(true);
  expect(new Set(responses.map(r => r.body.ticket)).size).toBe(1);
  expect(new Set(responses.map(r => r.body.startBefore)).size).toBe(1);
  expect(await TransferTicket.countDocuments()).toBe(1); expect(await OutboxEvent.countDocuments()).toBe(1);
});
it('caps the transfer start window at share expiry and cannot recover it after expiry', async () => {
  const token = await newToken(); const expiry = new Date(Date.now() + 10000);
  await Share.updateMany({}, { expiresAt: expiry });
  const key = nonce(); const result = await claim(token, key);
  expect(new Date(result.body.startBefore as string).getTime()).toBe(expiry.getTime());
  await Share.updateMany({}, { expiresAt: new Date(Date.now() - 1) });
  expect((await claim(token, key)).status).toBe(410);
  expect((await get(`/transfers/${result.body.ticket}`)).status).toBe(410);
});
