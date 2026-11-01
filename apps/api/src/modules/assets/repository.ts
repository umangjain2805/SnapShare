import mongoose from 'mongoose';
import { AppError } from '../../middleware/errors.js';
import type { UploadInput, SnippetInput } from '@snapshare/contracts';
import { AssetQuota, UploadSession, Snippet } from './model.js';
import { availableAsset } from '@snapshare/backend/models/lifecycle';
export const OWNER_QUOTA = 1024 * 1024 * 1024;
export const OWNER_ITEMS = 100;
export const assetRepository = {
  findUpload: (ownerId: string, id: string) => UploadSession.findOne({ _id: id, ownerId, ...availableAsset }),
  listUploads: (ownerId: string) => UploadSession.find({ ownerId, status: { $ne: 'aborted' }, cleanupStatus: { $ne: 'deleted' } }).sort({ createdAt: -1 }).limit(100),
  async createUpload(input: UploadInput & { ownerId: string; objectKey: string; expiresAt: Date }, session: mongoose.ClientSession) {
    const [created] = await UploadSession.create([{ ...input, status: 'initializing' }], { session }); return created!;
  },
  initializeUpload: (id: string, ownerId: string, storageUploadId: string) => UploadSession.findOneAndUpdate({ _id: id, ownerId, status: 'initializing', ...availableAsset }, { $set: { storageUploadId, status: 'uploading' } }, { new: true }).orFail(),
  transitionUpload: (id: string, ownerId: string, from: string, to: string) => UploadSession.findOneAndUpdate({ _id: id, ownerId, status: from, ...availableAsset }, { $set: { status: to } }, { new: true }),
  async createSnippet(ownerId: string, input: SnippetInput, session: mongoose.ClientSession) {
    const [created] = await Snippet.create([{ ...input, ownerId }], { session }); return created!;
  },
  listSnippets: (ownerId: string) => Snippet.find({ ownerId, ...availableAsset }).sort({ createdAt: -1 }).limit(100),
  async reserve<T>(ownerId: string, size: number, create: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
    // Initialize outside the transaction, then serialize reservations through one owner document.
    try { await AssetQuota.updateOne({ _id: ownerId }, { $setOnInsert: { bytes: 0, items: 0 } }, { upsert: true }); }
    catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error; }
    return mongoose.connection.transaction(async session => {
      const reserved = await AssetQuota.findOneAndUpdate({ _id: ownerId, bytes: { $lte: OWNER_QUOTA - size }, items: { $lt: OWNER_ITEMS } }, { $inc: { bytes: size, items: 1 } }, { session });
      if (!reserved) throw new AppError(409, 'Workspace limit reached (1 GiB or 100 items)');
      return create(session);
    });
  },
  async confirmAbort(id: string, ownerId: string, size: number) {
    await mongoose.connection.transaction(async session => {
      const changed = await UploadSession.updateOne({ _id: id, ownerId, status: 'aborting', quotaReleased: { $ne: true }, ...availableAsset }, { $set: { status: 'aborted', quotaReleased: true } }, { session });
      if (changed.modifiedCount) await AssetQuota.updateOne({ _id: ownerId }, { $inc: { bytes: -size, items: -1 } }, { session });
    });
  },
};
