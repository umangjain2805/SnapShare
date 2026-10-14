import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const env = z.object({ REDIS_URL: z.url(), LOG_LEVEL: z.enum(['info', 'debug', 'warn', 'error', 'silent']).default('info') }).parse(process.env);
const logger = pino({ level: env.LOG_LEVEL });
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
redis.on('error', () => logger.error('Redis connection unavailable'));
try {
  await redis.connect(); await redis.ping();
  logger.info('Worker scaffold ready; no Phase 4 consumers registered');
} catch { redis.disconnect(); process.exitCode = 1; }
const shutdown = () => { redis.disconnect(); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
