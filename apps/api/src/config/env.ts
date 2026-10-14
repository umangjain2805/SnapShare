import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
}).superRefine((env, ctx) => {
  const url = new URL(env.APP_URL);
  if (url.origin !== env.APP_URL) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'APP_URL must be an origin without a trailing slash or path' });
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Production requires HTTPS' });
});
export const parseEnv = (input: NodeJS.ProcessEnv) => schema.parse(input);
export type Env = z.infer<typeof schema>;
