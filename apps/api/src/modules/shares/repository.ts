import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Share, TransferTicket, OutboxEvent } from './model.js';
import { UploadSession, Snippet } from '../assets/model.js';
import { AppError } from '../../middleware/errors.js';
import type { CreateShareInput } from '@snapshare/contracts';
import { availableAsset } from '@snapshare/backend/models/lifecycle';
import { touchAsset } from '@snapshare/backend/cleanup';
const unavailable = () => new AppError(410, 'Share or transfer unavailable');
const transactionOptions = { readConcern: { level: 'snapshot' as const }, writeConcern: { w: 'majority' as const }, timeoutMS: 15000 };
export const shareRepository = {
  findUpload: (id: string, ownerId: string) => UploadSession.findOne({ _id: id, ownerId, status: 'quarantined', scanStatus: 'clean', ...availableAsset }),
  findSnippet: (id: string, ownerId: string) => Snippet.findOne({ _id: id, ownerId, ...availableAsset }),
  create: async (input: Omit<CreateShareInput, 'password'> & { ownerId: string; title: string; tokenHash: string; passwordHash: string; expiresAt: Date; createdAt: Date }) => {
    const { sourceType, sourceId, ownerId, title, tokenHash, passwordHash, expiresAt, createdAt } = input;
    return mongoose.connection.transaction(async session => {
      if (!(await touchAsset(sourceType, sourceId, ownerId, session)).modifiedCount) throw new AppError(409, 'Source unavailable or cleanup has started');
      const [share] = await Share.create([{ sourceType, sourceId, ownerId, title, tokenHash, passwordHash, expiresAt, createdAt }], { session }); return share!;
    }, transactionOptions);
  },
  findByToken: (tokenHash: string) => Share.findOne({ tokenHash }).select('+passwordHash'),
  list: (ownerId: string, before?: string) => Share.find({ ownerId, ...(before ? { _id: { $lt: before } } : {}) }).sort({ _id: -1 }).limit(51),
  revoke: (ownerId: string, id: string) => Share.findOneAndUpdate({ _id: id, ownerId }, { $set: { status: 'revoked' } }, { new: true }),
  async claim(shareId: string, claimHash: string, tokenHash: string) {
    return mongoose.connection.transaction(async session => {
      // Recompute time on transaction retries; never authorize using a stale pre-verification timestamp.
      const now = new Date();
      const previous = await TransferTicket.findOne({ shareId }).session(session);
      if (previous) {
        const share = await Share.findOne({ _id: shareId, status: 'claimed', expiresAt: { $gt: now } }).session(session);
        if (!share || previous.claimHash !== claimHash || previous.tokenHash !== tokenHash || previous.status !== 'issued' || previous.startBefore <= now) throw unavailable();
        return previous;
      }
      const share = await Share.findOneAndUpdate({ _id: shareId, status: 'active', expiresAt: { $gt: now }, maxDownloads: 1, downloadCount: { $lt: 1 } }, { $set: { status: 'claimed' }, $inc: { downloadCount: 1 } }, { session, new: true });
      if (!share) throw unavailable();
      if (!(await touchAsset(share.sourceType as 'upload' | 'snippet', share.sourceId, share.ownerId, session)).modifiedCount) throw unavailable();
      const startBefore = new Date(Math.min(now.getTime() + 120000, share.expiresAt.getTime()));
      share.transferUntil = new Date(startBefore.getTime() + 300000); await share.save({ session });
      const [ticket] = await TransferTicket.create([{ shareId, claimHash, tokenHash, startBefore }], { session });
      await OutboxEvent.create([{ eventId: randomUUID(), type: 'share.claimed', shareId, ownerId: share.ownerId }], { session });
      return ticket!;
    }, transactionOptions);
  },
  async redeem(tokenHash: string) {
    return mongoose.connection.transaction(async session => {
      const now = new Date();
      const ticket = await TransferTicket.findOneAndUpdate({ tokenHash, status: 'issued', startBefore: { $gt: now } }, { $set: { status: 'redeemed', redeemedAt: now, streamDeadline: new Date(now.getTime() + 300000), delivery: 'streaming' } }, { session, new: true });
      if (!ticket) throw unavailable();
      // Write the same share document as revocation, serializing revoke/redeem races.
      const share = await Share.findOneAndUpdate({ _id: ticket.shareId, status: 'claimed', expiresAt: { $gt: now } }, { $inc: { redemptionVersion: 1 } }, { session, new: true });
      if (!share) throw unavailable();
      return { ticket, share };
    }, transactionOptions);
  },
  delivery: (id: string, delivery: 'finished' | 'failed') => TransferTicket.updateOne({ _id: id, status: 'redeemed' }, { $set: { delivery } }),
};
