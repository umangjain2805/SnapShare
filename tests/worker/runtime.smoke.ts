import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startRedis } from '../helpers/redis.js';
import { createRuntime } from '../../apps/worker/src/runtime.js';
import { parseEnv } from '../../packages/backend/dist/env.js';
import { initializeModels } from '../../packages/backend/dist/initialize.js';
import { connectDatabase, disconnectDatabase } from '../../packages/backend/dist/database.js';
import { User, Notification, OutboxEvent, UploadSession, AssetQuota } from '../../packages/backend/dist/index.js';
import type { Storage } from '../../packages/backend/dist/storage.js';
async function until(check: () => Promise<boolean>, description: string) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${description}`);
}
let redis: Awaited<ReturnType<typeof startRedis>> | undefined;
let mongo: MongoMemoryReplSet | undefined;
let runtime: ReturnType<typeof createRuntime> | undefined;
let processWorker: ReturnType<typeof spawn> | undefined;
try {
  redis = await startRedis();
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await connectDatabase(mongo.getUri()); await initializeModels();
  const user = await User.create({ name: 'Worker test', email: 'worker@example.com', passwordHash: 'fixture' }); const ownerId = user.id as string;
  const event = () => OutboxEvent.create({ eventId: randomUUID(), type: 'share.claimed', ownerId, shareId: randomBytes(12).toString('hex') });
  const first = await event();
  const env = parseEnv({ NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), REDIS_URL: redis.url, WORKER_INTERVAL_MS: '1000', LOG_LEVEL: 'silent' });
  let deletionAttempts = 0;
  const storage: Storage = { async begin() { return ''; }, async sign() { return ''; }, async parts() { return []; }, async complete() {}, async head() { return null; }, async abort() {}, async remove() { deletionAttempts++; if (deletionAttempts === 1) throw new Error('Transient storage failure'); } };
  runtime = createRuntime(env, storage); assert.equal(runtime.isReady(), false); await runtime.start();
  await until(async () => (await OutboxEvent.findById(first._id))?.status === 'processed', 'initial notification');
  await until(async () => runtime!.isReady(), 'successful reconciliation readiness');
  await runtime.engine.notify(first.eventId); await runtime.engine.notify(first.eventId); assert.equal(await Notification.countDocuments(), 1);
  await runtime.close(); assert.equal(runtime.isReady(), false); runtime = undefined;
  const missed = await event();
  await AssetQuota.create({ _id: ownerId, bytes: 10, items: 1 });
  const upload = await UploadSession.create({ ownerId, filename: 'expired.txt', mimeType: 'text/plain', size: 10, fingerprint: 'a'.repeat(64), objectKey: 'quarantine/runtime-test', status: 'quarantined', expiresAt: new Date(0) });
  runtime = createRuntime(env, storage); await runtime.start();
  await until(async () => Boolean((await UploadSession.findById(upload._id))?.cleanupFailedAt), 'first cleanup failure');
  assert.equal((await UploadSession.findById(upload._id))!.purgeAfter, undefined);
  await until(async () => (await UploadSession.findById(upload._id))?.cleanupStatus === 'deleted', 'BullMQ cleanup retry');
  assert.ok(deletionAttempts >= 2); assert.equal((await AssetQuota.findById(ownerId))!.bytes, 0);
  assert.ok((await UploadSession.findById(upload._id))!.purgeAfter instanceof Date);
  await until(async () => (await OutboxEvent.findById(missed._id))?.status === 'processed', 'worker outage recovery');
  const cleanupJob = await runtime.cleanup.getJob(`cleanup-upload-${upload.id}`); assert.ok(cleanupJob && cleanupJob.attemptsMade >= 2);
  const port = redis.port; await redis.stop();
  const duringRedisOutage = await event();
  const dispatch = await runtime.engine.dispatch(); assert.ok(dispatch.failed > 0);
  assert.equal((await OutboxEvent.findById(duringRedisOutage._id))!.status, 'pending');
  redis = await startRedis(port);
  await OutboxEvent.updateOne({ _id: duringRedisOutage._id }, { nextDispatchAt: new Date(0) });
  await until(async () => (await OutboxEvent.findById(duringRedisOutage._id))?.status === 'processed', 'Redis outage and queue loss recovery');
  assert.equal(await Notification.countDocuments(), 3);
  await runtime.close(); runtime = undefined;
  const nativeEvent = await event();
  const reservation = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => reservation.once('listening', resolve));
  const healthAddress = reservation.address(); assert.ok(healthAddress && typeof healthAddress !== 'string');
  const healthPort = healthAddress.port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  processWorker = spawn(process.execPath, ['apps/worker/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: mongo.getUri(), REDIS_URL: redis.url, WORKER_HEALTH_PORT: String(healthPort), WORKER_INTERVAL_MS: '1000', EMAIL_PROVIDER: 'disabled', LOG_LEVEL: 'silent' } });
  await until(async () => (await OutboxEvent.findById(nativeEvent._id))?.status === 'processed', 'compiled separate worker process');
  assert.equal(await Notification.countDocuments(), 4);
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${healthPort}/ready`)).ok; } catch { return false; } }, 'compiled worker health readiness');
  const health = await fetch(`http://127.0.0.1:${healthPort}/health`);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await fetch(`http://127.0.0.1:${healthPort}/missing`)).status, 404);
  process.stdout.write('Real Redis/BullMQ smoke passed: duplicate events, worker restart, exponential cleanup retry, retained metadata, quota release, Redis outage, lost-queue reconciliation and compiled separate worker process.\n');
} finally {
  if (processWorker?.pid && processWorker.exitCode === null && processWorker.signalCode === null) { const stopped = new Promise<void>(resolve => processWorker!.once('exit', () => resolve())); processWorker.kill(); await stopped; }
  await runtime?.close(); await disconnectDatabase(); await mongo?.stop(); await redis?.stop();
}
