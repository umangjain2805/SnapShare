import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database.js';
import { createLogger } from './infrastructure/logger.js';
import { User, Session } from './modules/auth/model.js';
import { UploadSession, Snippet, AssetQuota } from './modules/assets/model.js';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);
try {
  await connectDatabase(env.MONGODB_URI);
  await Promise.all([User.init(), Session.init(), UploadSession.init(), Snippet.init(), AssetQuota.init()]);
  const server = createApp(env).listen(env.API_PORT, () => logger.info({ port: env.API_PORT }, 'API listening'));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => { void disconnectDatabase().finally(() => { clearTimeout(timeout); process.exit(0); }); });
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  logger.error('API startup failed; verify database connectivity');
  await disconnectDatabase(); process.exitCode = 1;
}
