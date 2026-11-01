import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../../packages/backend/dist/database.js';
import { initializeModels } from '../../packages/backend/dist/initialize.js';
import { Share, TransferTicket, UploadSession, Snippet, User, Session, AssetQuota } from '../../packages/backend/dist/index.js';
import { hashToken } from '../../apps/api/src/modules/auth/service.js';
let mongo: MongoMemoryReplSet; let app: ReturnType<typeof createApp>; let ownerId: string; let cookie: string; let other: string;
const token = () => randomBytes(32).toString('base64url');
const sourceId = '012345678901234567890123';
const get = (path: string, auth = cookie) => request(app).get(`/api${path}`).set('Cookie', auth);
const shareInput = () => ({ ownerId, sourceType: 'snippet', sourceId, title: 'Private title', passwordHash: 'private-password-hash', tokenHash: token(), expiresAt: new Date(Date.now() + 86400000) });
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await connectDatabase(mongo.getUri()); await initializeModels(); });
beforeEach(async () => {
  await Promise.all([Share.deleteMany({}), TransferTicket.deleteMany({}), UploadSession.deleteMany({}), Snippet.deleteMany({}), User.deleteMany({}), Session.deleteMany({}), AssetQuota.deleteMany({})]);
  app = createApp(parseEnv({ NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), LOG_LEVEL: 'silent' }));
  async function account(email: string) { const user = await User.create({ name: 'Owner', email, passwordHash: 'fixture' }); const raw = token(); await Session.create({ userId: user._id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86400000) }); return { id: user.id as string, cookie: `snapshare_session=${raw}` }; }
  const a = await account('a@example.com'); const b = await account('b@example.com'); ownerId = a.id; cookie = a.cookie; other = b.cookie;
});
afterAll(async () => { await disconnectDatabase(); await mongo?.stop(); });
it('aggregates only the owner records, counts transfer failures and separates reservations from stored bytes', async () => {
  for (const [i, cleanupStatus] of ['active', 'deleting', 'deleted'].entries()) await UploadSession.create({ ownerId, filename: 'file.txt', size: (i + 1) * 100, mimeType: 'text/plain', fingerprint: 'a'.repeat(64), objectKey: `quarantine/${i}`, status: 'quarantined', scanStatus: i === 0 ? 'pending' : 'clean', cleanupStatus, ...(i === 1 ? { cleanupFailedAt: new Date() } : {}), expiresAt: new Date(Date.now() + 86400000) });
  await Snippet.create({ ownerId, title: 'Snippet', text: 'hello', language: 'plaintext' }); await AssetQuota.create({ _id: ownerId, bytes: 305, items: 3 });
  await Share.create(shareInput());
  const claimed = await Share.create({ ...shareInput(), status: 'claimed', downloadCount: 1, expiresAt: new Date(Date.now() - 1000) });
  await TransferTicket.create({ shareId: claimed.id as string, claimHash: token(), tokenHash: token(), startBefore: new Date(), status: 'redeemed', delivery: 'failed' });
  await Share.create({ ...shareInput(), status: 'revoked', cleanupStatus: 'complete' });
  await Share.create({ ...shareInput(), expiresAt: new Date(Date.now() - 1000) });
  const foreign = await Share.create({ ...shareInput(), ownerId: 'foreign', title: 'Other owner secret', downloadCount: 1 });
  await TransferTicket.create({ shareId: foreign.id as string, claimHash: token(), tokenHash: token(), startBefore: new Date(), delivery: 'failed' });
  const result = await get('/me/analytics'); expect(result.status).toBe(200);
  expect(result.body.totals).toMatchObject({ uploads: 3, snippets: 1, shares: 4, claims: 1, activeShares: 1, expired: 2, revoked: 1, failedTransfers: 1, cleanupPending: 2, cleanupComplete: 1, pendingScan: 1, cleanupFailures: 1 });
  expect(result.body.storage).toMatchObject({ reservedBytes: 305, storedBytes: 300, items: 3, limitItems: 100 });
  expect(result.body.activity).toHaveLength(7); expect(result.body.activity.at(-1)).toMatchObject({ uploads: 3, shares: 4, claims: 1, failedTransfers: 1 });
  expect(result.text).not.toMatch(/Other owner secret|passwordHash|tokenHash|quarantine|private-password/);
  const isolated = await get('/me/analytics', other); expect(isolated.body.totals.shares).toBe(0); expect(isolated.body.storage.reservedBytes).toBe(0);
  expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['x-content-type-options']).toBe('nosniff');
});
it('requires authentication, validates query shape and rate limits cached reads', async () => {
  expect((await get('/me/analytics', '')).status).toBe(401);
  for (const query of ['days=365', 'days[$ne]=7', 'ownerId=foreign', 'days=7&days=30']) expect((await get(`/me/analytics?${query}`)).status).toBe(400);
  expect((await get('/me/analytics?days=30')).body.activity).toHaveLength(30);
  for (let i = 0; i < 55; i++) expect((await get('/me/analytics')).status).toBe(200);
  expect((await get('/me/analytics')).status).toBe(429);
});
it('paginates and filters owner shares and returns details without private bearer/storage secrets', async () => {
  const records = await Share.insertMany(Array.from({ length: 52 }, (_, i) => ({ ...shareInput(), title: `Share ${i}`, status: i === 0 ? 'revoked' : 'active' })));
  const first = await get('/me/shares'); expect(first.body.shares).toHaveLength(50);
  const second = await get(`/me/shares?before=${first.body.nextCursor}`); expect(second.body.shares).toHaveLength(2);
  const all = [...first.body.shares, ...second.body.shares] as { id: string }[]; expect(new Set(all.map(s => s.id)).size).toBe(52);
  expect((await get('/me/shares?state=revoked')).body.shares).toHaveLength(1);
  const detail = await get(`/me/shares/${records[0]!.id}`); expect(detail.body.share.title).toBe('Share 0'); expect(detail.body.share.transfer).toBeNull();
  expect(detail.text).not.toMatch(/passwordHash|tokenHash|objectKey|private-password/);
  expect((await get(`/me/shares/${records[0]!.id}`, other)).status).toBe(404);
  expect((await get('/me/shares?ownerId=foreign')).status).toBe(400);
});
it('serializes the 500 retained-share budget under concurrent creation requests', async () => {
  await Snippet.create({ _id: sourceId, ownerId, title: 'Code', text: 'hello', language: 'plaintext' });
  await Share.insertMany(Array.from({ length: 499 }, () => shareInput()));
  const create = () => request(app).post('/api/shares').set('Origin', 'http://localhost:5173').set('Cookie', cookie).send({ sourceType: 'snippet', sourceId, password: 'long-share-passphrase' });
  const results = await Promise.all([create(), create()]); expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  expect(await Share.countDocuments({ ownerId })).toBe(500);
});
