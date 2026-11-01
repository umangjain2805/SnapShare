import { config } from 'dotenv';
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
try {
  await connectDatabase(env.MONGODB_URI); await initializeModels();
  runtime = createRuntime(env, createStorage(env), createEmailProvider(env), (event, counts) => logger.info({ event, ...counts }, 'worker'));
  await runtime.start();
} catch {
  logger.error({ event: 'worker_startup_failed' }, 'Check database, Redis and worker configuration');
  await runtime?.close(); await disconnectDatabase(); process.exitCode = 1;
}
let stopping = false;
const shutdown = () => {
  if (stopping) return; stopping = true;
  const timeout = setTimeout(() => process.exit(1), 20000).unref();
  void (async () => { await runtime?.close(); await disconnectDatabase(); clearTimeout(timeout); })();
};
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
