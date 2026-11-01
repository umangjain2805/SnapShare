import { randomBytes, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import argon2 from 'argon2';
import type { CreateShareInput, ClaimShareInput, ShareView } from '@snapshare/contracts';
import type { Storage } from '../../infrastructure/storage.js';
import { hashToken } from '../auth/service.js';
import { AppError } from '../../middleware/errors.js';
import { shareRepository as repo } from './repository.js';
const passwordHash = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
let dummyHash: Promise<string> | undefined;
// Neither token nor idempotency key is stored raw. Recovery works across API restarts without storing a recoverable ticket secret.
export const deriveTicket = (token: string, key: string) => createHash('sha256').update('snapshare-transfer-v1\0').update(token).update('\0').update(key).digest('base64url');
export function createShareService(storage: Storage) {
  async function source(type: string, id: string, ownerId: string) {
    if (type === 'upload') {
      const upload = await repo.findUpload(id, ownerId);
      if (!upload) throw new AppError(409, 'File is unavailable or awaiting a trusted clean scan');
      return { filename: upload.filename, size: upload.size, objectKey: upload.objectKey, text: undefined };
    }
    const snippet = await repo.findSnippet(id, ownerId);
    if (!snippet) throw new AppError(404, 'Snippet not found');
    return { filename: `${snippet.title}.txt`, size: Buffer.byteLength(snippet.text, 'utf8'), objectKey: undefined, text: snippet.text };
  }
  return {
    async create(ownerId: string, input: CreateShareInput) {
      const asset = await source(input.sourceType, input.sourceId, ownerId);
      const token = randomBytes(32).toString('base64url');
      const hashedPassword = await passwordHash(input.password);
      const createdAt = new Date();
      const share = await repo.create({ sourceType: input.sourceType, sourceId: input.sourceId, ownerId, title: asset.filename, tokenHash: hashToken(token), passwordHash: hashedPassword, createdAt, expiresAt: new Date(createdAt.getTime() + 86400000) });
      return { id: share.id as string, token, expiresAt: share.expiresAt.toISOString() };
    },
    async list(ownerId: string, before?: string) {
      const records = await repo.list(ownerId, before);
      const shares: ShareView[] = records.slice(0, 50).map(s => ({ id: s.id as string, sourceType: s.sourceType as 'upload' | 'snippet', sourceId: s.sourceId, title: s.title, status: s.status === 'active' && s.expiresAt.getTime() <= Date.now() ? 'expired' : s.status, expiresAt: s.expiresAt.toISOString(), downloadCount: s.downloadCount, maxDownloads: s.maxDownloads, notificationsEnabled: s.notificationsEnabled }));
      return { shares: shares.map((share, i) => ({ ...share, cleanupStatus: records[i]!.cleanupStatus })), nextCursor: records.length > 50 ? shares.at(-1)!.id : null };
    },
    async revoke(ownerId: string, id: string) {
      if (!await repo.revoke(ownerId, id)) throw new AppError(404, 'Share not found');
    },
    async claim(token: string, input: ClaimShareInput) {
      const share = await repo.findByToken(hashToken(token));
      dummyHash ??= passwordHash(randomBytes(32).toString('hex'));
      const valid = await argon2.verify(share?.passwordHash ?? await dummyHash, input.password);
      if (!share || !valid) throw new AppError(403, 'Unable to authorize this share');
      const asset = await source(share.sourceType, share.sourceId, share.ownerId);
      const ticket = deriveTicket(token, input.idempotencyKey);
      const record = await repo.claim(share.id as string, hashToken(input.idempotencyKey), hashToken(ticket));
      return { ticket, startBefore: record.startBefore.toISOString(), filename: asset.filename, size: asset.size, sourceType: share.sourceType };
    },
    async redeem(token: string, signal: AbortSignal) {
      const { ticket, share } = await repo.redeem(hashToken(token));
      try {
        const asset = await source(share.sourceType, share.sourceId, share.ownerId);
        if (asset.objectKey && !storage.open) throw new AppError(503, 'File streaming is unavailable');
        const stream = asset.objectKey ? await storage.open!(asset.objectKey, signal) : Readable.from([Buffer.from(asset.text!, 'utf8')]);
        return { id: ticket.id as string, filename: asset.filename, size: asset.size, stream, deadline: ticket.streamDeadline! };
      } catch (error) { await repo.delivery(ticket.id as string, 'failed'); throw error; }
    },
    delivery: repo.delivery,
  };
}
export type ShareService = ReturnType<typeof createShareService>;
