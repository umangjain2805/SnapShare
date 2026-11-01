import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';
import type { Env } from '@snapshare/backend/env';
import type { Storage } from '@snapshare/backend/storage';
import type { EmailProvider } from './email.js';
import { createEngine } from './engine.js';
import { OutboxEvent, UploadSession } from '@snapshare/backend';
export function createRuntime(env: Env, storage: Storage, email?: EmailProvider, log: (event: string, counts?: object) => void = () => {}) {
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required for the worker');
  const redis = new URL(env.REDIS_URL);
  const connection: ConnectionOptions = { host: redis.hostname, port: Number(redis.port || 6379), username: redis.username ? decodeURIComponent(redis.username) : undefined, password: redis.password ? decodeURIComponent(redis.password) : undefined, db: Number(redis.pathname.slice(1) || 0), ...(redis.protocol === 'rediss:' ? { tls: {} } : {}), connectTimeout: 5000 };
  const queueOptions = { connection: { ...connection, maxRetriesPerRequest: 1, enableOfflineQueue: false } };
  const notifications = new Queue('snapshare-notifications', queueOptions); const cleanup = new Queue('snapshare-cleanup', queueOptions);
  for (const queue of [notifications, cleanup]) queue.on('error', () => log('queue_connection_error'));
  const ensure = async (queue: Queue, id: string, data: object) => {
    const previous = await queue.getJob(id);
    if (previous) {
      const state = await previous.getState();
      if (state === 'failed' || state === 'completed') await previous.retry(state, { resetAttemptsMade: true });
      else if (state === 'unknown') await queue.add('process', data, { jobId: id });
      return;
    }
    await queue.add('process', data, { jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 604800, count: 1000 } });
  };
  const engine = createEngine(storage, { notification: id => ensure(notifications, `notify-${id}`, { eventId: id }), cleanup: (type, id) => ensure(cleanup, `cleanup-${type}-${id}`, { type, id }) }, { retentionDays: env.METADATA_RETENTION_DAYS, email });
  const notifyWorker = new Worker('snapshare-notifications', async job => { const data = z.object({ eventId: z.uuid() }).parse(job.data); await engine.notify(data.eventId); }, { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 4 });
  const cleanupWorker = new Worker('snapshare-cleanup', async job => { const data = z.object({ type: z.enum(['upload', 'snippet']), id: z.string().regex(/^[a-f0-9]{24}$/) }).parse(job.data); await engine.cleanup(data.type, data.id); }, { connection: { ...connection, maxRetriesPerRequest: null }, concurrency: 2 });
  for (const worker of [notifyWorker, cleanupWorker]) {
    worker.on('error', () => log('worker_connection_error'));
    worker.on('failed', () => log('job_failed'));
    worker.on('completed', () => log('job_completed'));
    worker.on('stalled', () => log('job_stalled'));
  }
  let stopping = false; let timer: ReturnType<typeof setTimeout> | undefined; let running: Promise<void> | undefined;
  const cycle = async () => {
    try {
      const dispatched = await engine.dispatch(); const reconciled = await engine.reconcile();
      const [pendingEvents, oldest, notificationJobs, cleanupJobs, failedAssets] = await Promise.all([
        OutboxEvent.countDocuments({ status: 'pending' }), OutboxEvent.findOne({ status: 'pending' }).sort({ createdAt: 1 }).select('createdAt'),
        notifications.getJobCounts('waiting', 'active', 'delayed', 'failed'), cleanup.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        UploadSession.countDocuments({ cleanupStatus: 'deleting', cleanupFailedAt: { $exists: true } }),
      ]);
      log('reconciliation_cycle', { dispatched, reconciled, pendingEvents, oldestPendingMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0, notificationJobs, cleanupJobs, failedAssets });
    }
    catch { log('reconciliation_failed'); }
  };
  return {
    engine, notifications, cleanup, notifyWorker, cleanupWorker,
    async start() {
      await Promise.all([notifications.waitUntilReady(), cleanup.waitUntilReady(), notifyWorker.waitUntilReady(), cleanupWorker.waitUntilReady()]);
      const loop = () => { running = cycle().finally(() => { if (!stopping) timer = setTimeout(loop, env.WORKER_INTERVAL_MS); }); };
      loop(); log('worker_ready');
    },
    async close() { stopping = true; clearTimeout(timer); await running; await Promise.all([notifyWorker.close(), cleanupWorker.close()]); await Promise.all([notifications.close(), cleanup.close()]); },
  };
}
