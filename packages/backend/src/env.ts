import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  S3_BUCKET: z.string().min(3).optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  REDIS_URL: z.url().refine(value => { try { const url = new URL(value); return ['redis:', 'rediss:'].includes(url.protocol) && /^\/?\d*$/.test(url.pathname); } catch { return false; } }, 'Use a redis:// or rediss:// URL with a numeric database').optional(),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  METADATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  EMAIL_PROVIDER: z.enum(['disabled', 'webhook']).default('disabled'),
  EMAIL_WEBHOOK_URL: z.url().refine(value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } }, 'Use HTTPS without embedded credentials').optional(),
  EMAIL_WEBHOOK_TOKEN: z.string().min(32).optional(),
}).superRefine((env, ctx) => {
  const url = new URL(env.APP_URL);
  if (env.EMAIL_PROVIDER === 'webhook' && (!env.EMAIL_WEBHOOK_URL || !env.EMAIL_WEBHOOK_TOKEN)) ctx.addIssue({ code: 'custom', path: ['EMAIL_WEBHOOK_URL'], message: 'Webhook email requires an HTTPS URL and a separate token' });
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) ctx.addIssue({ code: 'custom', path: ['S3_ACCESS_KEY_ID'], message: 'Provide both S3 credential fields or use the default role credential chain' });
  if (url.origin !== env.APP_URL) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must be an origin without a trailing slash or path' });
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Production requires HTTPS' });
});
export const parseEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);
export type Env = z.infer<typeof schema>;
