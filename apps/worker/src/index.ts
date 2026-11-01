import { config } from 'dotenv';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { parseEnv } from '@snapshare/backend/env';
import { connectDatabase, disconnectDatabase } from '@snapshare/backend/database';
import { createStorage } from '@snapshare/backend/storage';
import { initializeModels } from '@snapshare/backend/initialize';
import { createEmailProvider } from './email.js';
import { createRuntime } from './runtime.js';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const env = parseEnv(process.env);
const logger = pino({ level: env.LOG_LEVEL });
let runtime: ReturnType<typeof createRuntime> | undefined;
let health: ReturnType<typeof createServer> | undefined;
try {
  await connectDatabase(env.MONGODB_URI); await initializeModels();
  runtime = createRuntime(env, createStorage(env), createEmailProvider(env), (event, counts) => logger.info({ event, ...counts }, 'worker'));
  await runtime.start();
  health = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
    const known = req.url === '/health' || req.url === '/ready';
    const ready = req.url === '/health' || runtime?.isReady();
    res.statusCode = !known ? 404 : ready ? 200 : 503;
    res.end(JSON.stringify({ status: !known ? 'not_found' : ready ? 'ok' : 'unavailable' }));
  });
  await new Promise<void>((resolve, reject) => {
    health!.once('error', reject);
    health!.listen(env.WORKER_HEALTH_PORT, '0.0.0.0', resolve);
  });
} catch {
  logger.error({ event: 'worker_startup_failed' }, 'Check database, Redis and worker configuration');
  health?.close();
  await runtime?.close(); await disconnectDatabase(); process.exitCode = 1;
}
let stopping = false;
const shutdown = () => {
  if (stopping) return; stopping = true;
  const timeout = setTimeout(() => process.exit(1), 20000).unref();
  health?.close();
  void (async () => { await runtime?.close(); await disconnectDatabase(); clearTimeout(timeout); })();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
