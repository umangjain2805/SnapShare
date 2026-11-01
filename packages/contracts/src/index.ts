import { z } from 'zod';
export const loginSchema = z.object({
  email: z.email().max(254).trim().toLowerCase(),
  password: z.string().min(1).max(128),
}).strict();
export const registerSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(128),
});
export const publicUserSchema = z.object({ id: z.string(), name: z.string(), email: z.email() });
export type PublicUser = z.infer<typeof publicUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export const PART_SIZE = 8 * 1024 * 1024;
export const MAX_FILE_SIZE = 256 * 1024 * 1024;
export const allowedMimeTypes = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/zip'] as const;
export const uploadInputSchema = z.object({
  filename: z.string().trim().min(1).max(180).refine(value => !/[\\/]/.test(value) && Array.from(value).every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127), 'Use a plain filename'),
  size: z.number().int().min(1).max(MAX_FILE_SIZE),
  mimeType: z.enum(allowedMimeTypes),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((input, ctx) => {
  const extensions: Record<string, string[]> = { 'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'text/plain': ['txt'], 'application/zip': ['zip'] };
  if (!extensions[input.mimeType]?.includes(input.filename.split('.').at(-1)!.toLowerCase())) ctx.addIssue({ code: 'custom', path: ['filename'], message: 'Filename extension must match the supported file type' });
});
export const partInputSchema = z.object({ partNumber: z.number().int().min(1).max(Math.ceil(MAX_FILE_SIZE / PART_SIZE)) }).strict();
export const languages = ['plaintext', 'javascript', 'typescript', 'css', 'markup', 'json', 'python'] as const;
export const snippetInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  language: z.enum(languages),
  text: z.string().min(1).max(32768).refine(text => new TextEncoder().encode(text).length <= 32768, 'Maximum 32 KiB of UTF-8 text'),
}).strict();
export type UploadInput = z.infer<typeof uploadInputSchema>;
export type SnippetInput = z.infer<typeof snippetInputSchema>;
export type UploadView = UploadInput & { id: string; status: string; scanStatus: string; cleanupStatus?: string; cleanupFailed?: boolean; expiresAt: string; partSize: number; parts: { partNumber: number; size: number; etag: string }[] };
export type SnippetView = SnippetInput & { id: string };

export const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const createShareSchema = z.object({
  sourceType: z.enum(['upload', 'snippet']), sourceId: z.string().regex(/^[a-f0-9]{24}$/i).toLowerCase(),
  password: z.string().min(12).max(128),
}).strict();
export const claimShareSchema = z.object({ password: z.string().min(1).max(128), idempotencyKey: opaqueTokenSchema }).strict();
export type CreateShareInput = z.infer<typeof createShareSchema>;
export type ClaimShareInput = z.infer<typeof claimShareSchema>;
export type ShareView = { id: string; sourceType: 'upload' | 'snippet'; sourceId: string; title: string; status: string; expiresAt: string; downloadCount: number; maxDownloads: number; notificationsEnabled: boolean; cleanupStatus?: string };
export type ClaimView = { ticket: string; startBefore: string; filename: string; size: number; sourceType: 'upload' | 'snippet' };
export const analyticsQuerySchema = z.object({ days: z.enum(['7', '30']).default('7') }).strict();
export const shareListQuerySchema = z.object({ before: z.string().regex(/^[a-f0-9]{24}$/i).optional(), state: z.enum(['active', 'expired', 'claimed', 'revoked']).optional() }).strict();
export type AnalyticsResult = {
  sampledAt: string; days: number;
  totals: { uploads: number; snippets: number; shares: number; claims: number; activeShares: number; expired: number; revoked: number; failedTransfers: number; finishedTransfers: number; cleanupPending: number; cleanupComplete: number; pendingScan: number; cleanupFailures: number };
  storage: { reservedBytes: number; storedBytes: number; limitBytes: number; items: number; limitItems: number };
  activity: { date: string; uploads: number; shares: number; claims: number; failedTransfers: number }[];
};
export type ShareDetail = { id: string; title: string; status: string; createdAt: string; expiresAt: string; sourceType: string; sourceId: string; downloadCount: number; maxDownloads: number; notificationsEnabled: boolean; cleanupStatus: string; transfer: null | { status: string; delivery: string; startBefore: string; redeemedAt: string | null; streamDeadline: string | null } };
