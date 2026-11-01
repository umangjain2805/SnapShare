import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { UploadSession, Snippet, AssetQuota } from './models/assets.js';
import { Share, TransferTicket, OutboxEvent } from './models/shares.js';
import { availableAsset } from './models/lifecycle.js';
export type SourceType = 'upload' | 'snippet';
const transactionOptions = { readConcern: { level: 'snapshot' as const }, writeConcern: { w: 'majority' as const }, timeoutMS: 15000 };
export const updateAsset = (type: SourceType, filter: Record<string, unknown>, update: Record<string, unknown>, session?: mongoose.ClientSession) => type === 'upload' ? UploadSession.updateOne(filter, update, { session }) : Snippet.updateOne(filter, update, { session });
export async function touchAsset(type: SourceType, id: string, ownerId: string, session: mongoose.ClientSession) {
  const filter = { _id: id, ownerId, ...availableAsset, ...(type === 'upload' ? { status: 'quarantined', scanStatus: 'clean' } : {}) };
  return updateAsset(type, filter, { $inc: { referenceVersion: 1 } }, session);
}
async function asset(type: SourceType, id: string, session?: mongoose.ClientSession) {
  if (type === 'upload') {
    const doc = await UploadSession.findById(id).session(session ?? null);
    return doc ? { id, ownerId: doc.ownerId, size: doc.size, status: doc.status, objectKey: doc.objectKey, storageUploadId: doc.storageUploadId, expiresAt: doc.expiresAt, cleanupStatus: doc.cleanupStatus, deletedAt: doc.deletedAt, cleanupLeaseUntil: doc.cleanupLeaseUntil } : null;
  }
  const doc = await Snippet.findById(id).session(session ?? null);
  return doc ? { id, ownerId: doc.ownerId, size: Buffer.byteLength(doc.text, 'utf8'), status: 'snippet', objectKey: undefined, storageUploadId: undefined, expiresAt: undefined, cleanupStatus: doc.cleanupStatus, deletedAt: doc.deletedAt, cleanupLeaseUntil: doc.cleanupLeaseUntil } : null;
}
export async function acquireCleanup(type: SourceType, id: string) {
  return mongoose.connection.transaction(async session => {
    const now = new Date(); const doc = await asset(type, id, session);
    if (!doc || doc.cleanupStatus === 'deleted') return { kind: 'done' as const, deletedAt: doc?.deletedAt };
    if (doc.cleanupStatus === 'deleting' && doc.cleanupLeaseUntil && doc.cleanupLeaseUntil > now) return { kind: 'deferred' as const };
    // Older clients could supply mixed-case ObjectId strings; protect those references too.
    const references = { sourceType: type, sourceId: { $regex: `^${id}$`, $options: 'i' } };
    const protectedShare = await Share.exists({ ...references, $or: [{ status: 'active', expiresAt: { $gt: now } }, { transferUntil: { $gt: now } }] }).session(session);
    if (protectedShare) return { kind: 'deferred' as const };
    if (doc.cleanupStatus !== 'deleting') {
      const hasShare = await Share.exists(references).session(session);
      // Unshared snippets remain private; abandoned file sessions get a 10-minute in-flight-operation grace.
      if (!hasShare && (type === 'snippet' || !doc.expiresAt || doc.expiresAt.getTime() + 600000 > now.getTime())) return { kind: 'deferred' as const };
    }
    const lease = randomUUID();
    await updateAsset(type, { _id: id }, { $set: { cleanupStatus: 'deleting', cleanupLease: lease, cleanupLeaseUntil: new Date(now.getTime() + 300000) }, $inc: { cleanupAttempts: 1, referenceVersion: 1 } }, session);
    return { kind: 'acquired' as const, lease, asset: doc };
  }, transactionOptions);
}
export async function finishCleanup(type: SourceType, id: string, lease: string, retentionDays: number) {
  return mongoose.connection.transaction(async session => {
    const doc = await asset(type, id, session); if (!doc) return;
    const now = new Date();
    const changed = await updateAsset(type, { _id: id, cleanupStatus: 'deleting', cleanupLease: lease }, { $set: { cleanupStatus: 'deleted', deletedAt: now, purgeAfter: new Date(now.getTime() + retentionDays * 86400000), quotaReleased: true, ...(type === 'snippet' ? { text: '' } : {}) }, $unset: { cleanupLease: 1, cleanupLeaseUntil: 1, cleanupFailedAt: 1 } }, session);
    if (changed.modifiedCount && doc.status !== 'aborted') await AssetQuota.updateOne({ _id: doc.ownerId }, { $inc: { bytes: -doc.size, items: -1 } }, { session });
  }, transactionOptions);
}
export async function markReferencesCleaned(type: SourceType, id: string, retentionDays: number) {
  const doc = await asset(type, id); if (!doc?.deletedAt) return;
  const purgeAfter = new Date(doc.deletedAt.getTime() + retentionDays * 86400000);
  // Batched updates are restartable. No metadata receives a purge deadline before the verified asset deletion.
  const references = { sourceType: type, sourceId: { $regex: `^${id}$`, $options: 'i' } };
  const shares = await Share.find({ ...references, cleanupStatus: { $ne: 'complete' } }).select('_id').limit(100);
  for (const share of shares) {
    await TransferTicket.updateMany({ shareId: share.id as string }, { $set: { purgeAfter } });
    await OutboxEvent.updateMany({ shareId: share.id as string, status: 'processed' }, { $set: { purgeAfter } });
    await Share.updateOne({ _id: share._id }, { $set: { cleanupStatus: 'complete', cleanupCompletedAt: doc.deletedAt, purgeAfter } });
  }
}
export const failCleanup = (type: SourceType, id: string, lease: string) => updateAsset(type, { _id: id, cleanupStatus: 'deleting', cleanupLease: lease }, { $set: { cleanupFailedAt: new Date(), cleanupLeaseUntil: new Date(0) } });
