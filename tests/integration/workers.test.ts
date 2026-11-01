import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
import { initializeModels } from '../../packages/backend/dist/initialize.js';
import { connectDatabase, disconnectDatabase } from '../../packages/backend/dist/database.js';
import { UploadSession, Share, OutboxEvent, Notification, AssetQuota, User, Session, TransferTicket, Snippet } from '../../packages/backend/dist/index.js';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnv } from '../../apps/api/src/config/env.js';
import { createEngine } from '../../apps/worker/src/engine.js';
import type { Storage } from '../../packages/backend/dist/storage.js';
let mongo: MongoMemoryReplSet; let fail = false;
const storage: Storage = { async begin(){return 'id';}, async sign(){return '';}, async parts(){return [];}, async complete(){},async head(){return null;},async abort(){},async remove(){if(fail) throw new Error('offline');} };
const sink = { async notification(){}, async cleanup(){} };
beforeAll(async()=>{mongo=await MongoMemoryReplSet.create({replSet:{count:1}});await connectDatabase(mongo.getUri());await initializeModels();});
beforeEach(async()=>{fail=false;await Promise.all([UploadSession.deleteMany({}),Share.deleteMany({}),OutboxEvent.deleteMany({}),Notification.deleteMany({}),AssetQuota.deleteMany({}), User.deleteMany({}), Session.deleteMany({}), TransferTicket.deleteMany({}), Snippet.deleteMany({})]);});
afterAll(async()=>{await disconnectDatabase();await mongo.stop();});
it('deduplicates notifications and keeps failed dispatch durable',async()=>{
 const eventId=randomUUID();await OutboxEvent.create({eventId,type:'share.claimed',shareId:'012345678901234567890123',ownerId:'012345678901234567890123'});
 const engine=createEngine(storage,sink);await Promise.all([engine.notify(eventId),engine.notify(eventId)]);expect(await Notification.countDocuments()).toBe(1);expect((await OutboxEvent.findOne())!.status).toBe('processed');
 await OutboxEvent.updateMany({},{$set:{status:'pending'}});
 const offline=createEngine(storage,{...sink,async notification(){throw new Error('offline');}});expect((await offline.dispatch()).failed).toBe(1);expect((await OutboxEvent.findOne())!.status).toBe('pending');
});
const ownerId = '012345678901234567890123';
async function fixture() {
  await AssetQuota.create({ _id: ownerId, bytes: 10, items: 1 });
  return UploadSession.create({ ownerId, filename: 'private.txt', size: 10, mimeType: 'text/plain', fingerprint: 'b'.repeat(64), objectKey: `quarantine/${randomUUID()}`, status: 'quarantined', scanStatus: 'clean', expiresAt: new Date(Date.now() - 86400000) });
}
function reference(id: string, extra: object = {}) { return Share.create({ ownerId, sourceType: 'upload', sourceId: id, title: 'Private', tokenHash: randomUUID(), passwordHash: 'test', expiresAt: new Date(Date.now() - 1000), ...extra }); }
it('waits for every reference and transfer window, including mixed-case legacy IDs', async () => {
  const upload = await fixture(); const id = upload.id as string;
  const active = await reference(id.toUpperCase(), { expiresAt: new Date(Date.now() + 60000) });
  const transferring = await reference(id, { status: 'claimed', transferUntil: new Date(Date.now() + 60000) });
  const engine = createEngine(storage, sink);
  await engine.cleanup('upload', id); expect((await UploadSession.findById(id))!.cleanupStatus).toBe('active');
  await Share.updateOne({ _id: active._id }, { status: 'revoked' });
  await engine.cleanup('upload', id); expect((await UploadSession.findById(id))!.purgeAfter).toBeUndefined();
  await Share.updateOne({ _id: transferring._id }, { transferUntil: new Date(Date.now() - 1) });
  await engine.cleanup('upload', id);
  expect((await UploadSession.findById(id))!.cleanupStatus).toBe('deleted');
  expect((await Share.findById(active._id))!.cleanupStatus).toBe('complete');
  expect((await Share.findById(transferring._id))!.purgeAfter).toBeInstanceOf(Date);
});
it('recovers an expired cleanup lease and retains pending outbox events after object cleanup', async () => {
  const upload = await fixture(); const share = await reference(upload.id as string);
  await UploadSession.updateOne({ _id: upload._id }, { cleanupStatus: 'deleting', cleanupLease: 'lost-worker', cleanupLeaseUntil: new Date(0) });
  const event = await OutboxEvent.create({ eventId: randomUUID(), ownerId, shareId: share.id as string, type: 'share.claimed' });
  const queued: string[] = [];
  const engine = createEngine(storage, { ...sink, async cleanup(type, id) { queued.push(`${type}-${id}`); } });
  expect((await engine.reconcile()).enqueued).toBeGreaterThan(0); expect(queued).toContain(`upload-${upload.id}`);
  await engine.cleanup('upload', upload.id as string);
  expect((await OutboxEvent.findById(event._id))!.purgeAfter).toBeUndefined();
  await engine.notify(event.eventId);
  expect((await OutboxEvent.findById(event._id))!.purgeAfter).toBeInstanceOf(Date);
});
it('keeps in-app delivery when email fails and retries with the stable event ID', async () => {
  await User.create({ _id: ownerId, name: 'Owner', email: 'owner@example.com', passwordHash: 'test' });
  const event = await OutboxEvent.create({ eventId: randomUUID(), ownerId, shareId: ownerId, type: 'share.claimed' });
  const keys: string[] = []; let offline = true;
  const engine = createEngine(storage, sink, { email: { async send(input) { keys.push(input.idempotencyKey); if (offline) throw new Error('offline'); } } });
  await expect(engine.notify(event.eventId)).rejects.toThrow('notification_delivery_failed');
  expect(await Notification.countDocuments()).toBe(1); expect((await Notification.findOne())!.emailStatus).toBe('failed');
  expect((await OutboxEvent.findById(event._id))!.status).toBe('pending');
  offline = false; await engine.notify(event.eventId); await engine.notify(event.eventId);
  expect(keys).toEqual([event.eventId, event.eventId]); expect(await Notification.countDocuments()).toBe(1);
  expect((await Notification.findOne())!.emailStatus).toBe('sent');
});
it('protects notification ownership and serves the API independently of the worker/provider', async () => {
  const app = createApp(parseEnv({ NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost/test', LOG_LEVEL: 'silent' }), storage);
  const response = await request(app).post('/api/auth/register').set('Origin', 'http://localhost:5173').send({ name: 'Owner', email: 'notify@example.com', password: 'a-long-test-passphrase' });
  const cookie = String(response.headers['set-cookie']![0]).split(';')[0]!;
  const own = await Notification.create({ ownerId: response.body.user.id as string, sourceEventId: randomUUID(), shareId: ownerId, message: 'Your share was claimed.' });
  const foreign = await Notification.create({ ownerId, sourceEventId: randomUUID(), shareId: ownerId, message: 'Private other message' });
  expect((await request(app).get('/api/me/notifications')).status).toBe(401);
  const listed = await request(app).get('/api/me/notifications').set('Cookie', cookie);
  expect(listed.body.unreadCount).toBe(1); expect(listed.body.notifications).toHaveLength(1); expect(listed.text).not.toContain('Private other');
  const read = (id: string) => request(app).post(`/api/me/notifications/${id}/read`).set('Origin', 'http://localhost:5173').set('Cookie', cookie).send({});
  expect((await read(foreign.id as string)).status).toBe(404); expect((await read(own.id as string)).status).toBe(204);
  expect((await request(app).get('/api/me/notifications').set('Cookie', cookie)).body.unreadCount).toBe(0);
});
it('keeps unshared snippets and fresh sessions, and never releases already-aborted quota twice', async () => {
  const snippet = await Snippet.create({ ownerId, title: 'Private', language: 'plaintext', text: 'secret' });
  const upload = await fixture(); await UploadSession.updateOne({ _id: upload._id }, { expiresAt: new Date(Date.now() + 60000) });
  const engine = createEngine(storage, sink); await engine.cleanup('snippet', snippet.id as string); await engine.cleanup('upload', upload.id as string);
  expect((await Snippet.findById(snippet._id))!.cleanupStatus).toBe('active'); expect((await UploadSession.findById(upload._id))!.cleanupStatus).toBe('active');
  await UploadSession.updateOne({ _id: upload._id }, { expiresAt: new Date(0), status: 'aborted', quotaReleased: true });
  await AssetQuota.updateOne({ _id: ownerId }, { bytes: 0, items: 0 }); await engine.cleanup('upload', upload.id as string);
  expect((await AssetQuota.findById(ownerId))!.bytes).toBe(0); expect((await AssetQuota.findById(ownerId))!.items).toBe(0);
});
it('retains keys and quota on deletion failure then cleans and releases once',async()=>{
 const ownerId='012345678901234567890123';await AssetQuota.create({_id:ownerId,bytes:10,items:1});
 const upload=await UploadSession.create({ownerId,filename:'a.txt',size:10,mimeType:'text/plain',fingerprint:'a'.repeat(64),objectKey:'quarantine/test/key',status:'quarantined',expiresAt:new Date(Date.now()-86400000)});
 const engine=createEngine(storage,sink);fail=true;await expect(engine.cleanup('upload',upload.id as string)).rejects.toThrow();
 let record=await UploadSession.findById(upload._id);expect(record!.purgeAfter).toBeUndefined();expect(record!.objectKey).toBe('quarantine/test/key');expect((await AssetQuota.findById(ownerId))!.bytes).toBe(10);
 fail=false;await engine.cleanup('upload',upload.id as string);await engine.cleanup('upload',upload.id as string);record=await UploadSession.findById(upload._id);expect(record!.cleanupStatus).toBe('deleted');expect(record!.purgeAfter).toBeInstanceOf(Date);expect((await AssetQuota.findById(ownerId))!.bytes).toBe(0);
});
