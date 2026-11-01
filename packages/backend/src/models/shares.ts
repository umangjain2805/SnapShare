import { Schema, model } from 'mongoose';
const shareSchema = new Schema({
  ownerId: { type: String, required: true },
  sourceType: { type: String, enum: ['upload', 'snippet'], required: true }, sourceId: { type: String, required: true },
  title: { type: String, required: true }, tokenHash: { type: String, required: true, unique: true }, passwordHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true }, status: { type: String, enum: ['active', 'claimed', 'revoked'], default: 'active', required: true },
  maxDownloads: { type: Number, default: 1, required: true }, downloadCount: { type: Number, default: 0, required: true },
  notificationsEnabled: { type: Boolean, default: true, required: true }, transferUntil: Date,
  redemptionVersion: { type: Number, default: 0 },
  cleanupStatus: { type: String, enum: ['pending', 'complete'], default: 'pending' }, cleanupCompletedAt: Date, purgeAfter: Date,
  lastCleanupQueuedAt: Date,
}, { timestamps: true });
shareSchema.index({ ownerId: 1, _id: -1 }); shareSchema.index({ status: 1, expiresAt: 1 });
shareSchema.index({ sourceType: 1, sourceId: 1, status: 1 });
shareSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
export const Share = model('Share', shareSchema);
const ticketSchema = new Schema({
  shareId: { type: String, required: true, unique: true }, claimHash: { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true }, status: { type: String, enum: ['issued', 'redeemed'], default: 'issued', required: true },
  startBefore: { type: Date, required: true }, redeemedAt: Date, streamDeadline: Date,
  delivery: { type: String, enum: ['pending', 'streaming', 'finished', 'failed'], default: 'pending', required: true },
  purgeAfter: Date,
}, { timestamps: true });
ticketSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
export const TransferTicket = model('TransferTicket', ticketSchema);
const outboxSchema = new Schema({
  eventId: { type: String, required: true, unique: true }, type: { type: String, enum: ['share.claimed'], required: true },
  shareId: { type: String, required: true }, ownerId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processed'], default: 'pending', required: true },
  nextDispatchAt: Date, lastEnqueuedAt: Date, dispatchAttempts: { type: Number, default: 0 }, dispatchFailedAt: Date,
  processedAt: Date, purgeAfter: Date,
}, { timestamps: true });
outboxSchema.index({ shareId: 1, type: 1 }, { unique: true }); outboxSchema.index({ status: 1, createdAt: 1 });
outboxSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
export const OutboxEvent = model('OutboxEvent', outboxSchema);
// purgeAfter is assigned only after cleanup succeeds; expiresAt is never a TTL index.
