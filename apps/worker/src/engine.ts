import { randomUUID } from 'node:crypto';
import { Share, TransferTicket, OutboxEvent, UploadSession, Snippet, Notification, User } from '@snapshare/backend';
import { acquireCleanup, finishCleanup, markReferencesCleaned, failCleanup, type SourceType } from '@snapshare/backend/cleanup';
import type { Storage } from '@snapshare/backend/storage';
import type { EmailProvider } from './email.js';
export interface JobSink { notification(eventId: string): Promise<void>; cleanup(type: SourceType, id: string): Promise<void> }
export function createEngine(storage: Storage, sink: JobSink, options: { retentionDays?: number; email?: EmailProvider } = {}) {
  const retentionDays = options.retentionDays ?? 7;
  return {
    async dispatch() {
      let enqueued = 0; let failed = 0;
      const events = await OutboxEvent.find({ status: 'pending', $or: [{ nextDispatchAt: { $lte: new Date() } }, { nextDispatchAt: { $exists: false } }] }).sort({ nextDispatchAt: 1, _id: 1 }).limit(100);
      for (const event of events) {
        try {
          await sink.notification(event.eventId);
          await OutboxEvent.updateOne({ _id: event._id, status: 'pending' }, { $set: { lastEnqueuedAt: new Date(), nextDispatchAt: new Date(Date.now() + 60000) }, $inc: { dispatchAttempts: 1 }, $unset: { dispatchFailedAt: 1 } }); enqueued++;
        } catch {
          await OutboxEvent.updateOne({ _id: event._id, status: 'pending' }, { $set: { dispatchFailedAt: new Date(), nextDispatchAt: new Date(Date.now() + 10000) }, $inc: { dispatchAttempts: 1 } }); failed++;
        }
      }
      return { enqueued, failed };
    },
    async notify(eventId: string) {
      const event = await OutboxEvent.findOne({ eventId }); if (!event || event.status === 'processed') return;
      const share = await Share.findById(event.shareId);
      if (share?.notificationsEnabled !== false) {
        try { await Notification.updateOne({ sourceEventId: eventId }, { $setOnInsert: { ownerId: event.ownerId, sourceEventId: eventId, shareId: event.shareId, message: share ? `Your share "${share.title}" was claimed.` : 'Your share was claimed.', emailStatus: options.email ? 'pending' : 'disabled' } }, { upsert: true }); }
        catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error; }
        if (options.email) {
          const lease = randomUUID();
          const notification = await Notification.findOneAndUpdate({ sourceEventId: eventId, emailStatus: { $nin: ['sent', 'disabled'] }, $or: [{ emailLeaseUntil: { $lte: new Date() } }, { emailLeaseUntil: { $exists: false } }] }, { $set: { emailStatus: 'sending', emailLease: lease, emailLeaseUntil: new Date(Date.now() + 60000) }, $inc: { emailAttempts: 1 } }, { new: true });
          if (notification) {
            try {
              const user = await User.findById(event.ownerId);
              if (user) await options.email.send({ idempotencyKey: eventId, to: user.email, subject: 'Your share was claimed', text: 'Your SnapShare share was claimed. This does not confirm that the recipient saved the download.' });
              await Notification.updateOne({ sourceEventId: eventId, emailLease: lease }, { $set: { emailStatus: user ? 'sent' : 'disabled', emailSentAt: new Date() }, $unset: { emailLease: 1, emailLeaseUntil: 1 } });
            } catch {
              await Notification.updateOne({ sourceEventId: eventId, emailLease: lease }, { $set: { emailStatus: 'failed', emailLeaseUntil: new Date(0) } });
              throw new Error('notification_delivery_failed');
            }
          } else {
            const existing = await Notification.findOne({ sourceEventId: eventId });
            if (!existing || !['sent', 'disabled'].includes(existing.emailStatus)) throw new Error('notification_delivery_in_progress');
          }
        }
      }
      await OutboxEvent.updateOne({ _id: event._id }, { $set: { status: 'processed', processedAt: new Date(), ...(share?.cleanupStatus === 'complete' && share.purgeAfter ? { purgeAfter: share.purgeAfter } : {}) } });
    },
    async cleanup(type: SourceType, id: string) {
      const result = await acquireCleanup(type, id);
      if (result.kind === 'deferred') return;
      if (result.kind === 'done') { await markReferencesCleaned(type, id, retentionDays); return; }
      try {
        if (type === 'upload') {
          if (!storage.remove || !result.asset.objectKey) throw new Error('Storage cleanup not configured');
          await storage.remove(result.asset.objectKey, result.asset.storageUploadId ?? undefined);
        }
        await finishCleanup(type, id, result.lease, retentionDays);
        await markReferencesCleaned(type, id, retentionDays);
      } catch {
        await failCleanup(type, id, result.lease); throw new Error('asset_cleanup_failed');
      }
    },
    async reconcile() {
      const now = new Date(); let enqueued = 0; let failed = 0;
      await TransferTicket.updateMany({ status: 'redeemed', delivery: 'streaming', streamDeadline: { $lte: now } }, { $set: { delivery: 'failed' } });
      const references = await Share.find({ cleanupStatus: { $ne: 'complete' }, $and: [{ $or: [{ status: { $ne: 'active' } }, { expiresAt: { $lte: now } }] }, { $or: [{ transferUntil: { $lte: now } }, { transferUntil: { $exists: false } }] }] }).sort({ lastCleanupQueuedAt: 1, _id: 1 }).limit(100);
      for (const share of references) {
        try { await sink.cleanup(share.sourceType as SourceType, share.sourceId); await Share.updateOne({ _id: share._id }, { $set: { lastCleanupQueuedAt: now } }); enqueued++; } catch { failed++; }
      }
      const staleUploads = await UploadSession.find({ cleanupStatus: { $ne: 'deleted' }, expiresAt: { $lte: new Date(now.getTime() - 600000) } }).sort({ lastCleanupQueuedAt: 1, _id: 1 }).limit(100);
      for (const upload of staleUploads) {
        try { await sink.cleanup('upload', upload.id as string); await UploadSession.updateOne({ _id: upload._id }, { $set: { lastCleanupQueuedAt: now } }); enqueued++; } catch { failed++; }
      }
      const stranded = await Snippet.find({ cleanupStatus: 'deleting', cleanupLeaseUntil: { $lte: now } }).sort({ lastCleanupQueuedAt: 1, _id: 1 }).limit(100);
      for (const snippet of stranded) {
        try { await sink.cleanup('snippet', snippet.id as string); await Snippet.updateOne({ _id: snippet._id }, { $set: { lastCleanupQueuedAt: now } }); enqueued++; } catch { failed++; }
      }
      return { enqueued, failed };
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
