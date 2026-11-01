import { Schema, model } from 'mongoose';
const shareSchema = new Schema({
  ownerId: { type: String, required: true },
  sourceType: { type: String, enum: ['upload', 'snippet'], required: true }, sourceId: { type: String, required: true },
  title: { type: String, required: true }, tokenHash: { type: String, required: true, unique: true }, passwordHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true }, status: { type: String, enum: ['active', 'claimed', 'revoked'], default: 'active', required: true },
  maxDownloads: { type: Number, default: 1, required: true }, downloadCount: { type: Number, default: 0, required: true },
  notificationsEnabled: { type: Boolean, default: true, required: true }, transferUntil: Date,
  redemptionVersion: { type: Number, default: 0 },
}, { timestamps: true });
shareSchema.index({ ownerId: 1, _id: -1 }); shareSchema.index({ status: 1, expiresAt: 1 });
export const Share = model('Share', shareSchema);
const ticketSchema = new Schema({
  shareId: { type: String, required: true, unique: true }, claimHash: { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true }, status: { type: String, enum: ['issued', 'redeemed'], default: 'issued', required: true },
  startBefore: { type: Date, required: true }, redeemedAt: Date, streamDeadline: Date,
  delivery: { type: String, enum: ['pending', 'streaming', 'finished', 'failed'], default: 'pending', required: true },
}, { timestamps: true });
export const TransferTicket = model('TransferTicket', ticketSchema);
const outboxSchema = new Schema({
  eventId: { type: String, required: true, unique: true }, type: { type: String, enum: ['share.claimed'], required: true },
  shareId: { type: String, required: true }, ownerId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'processed'], default: 'pending', required: true },
}, { timestamps: true });
outboxSchema.index({ shareId: 1, type: 1 }, { unique: true }); outboxSchema.index({ status: 1, createdAt: 1 });
export const OutboxEvent = model('OutboxEvent', outboxSchema);
// Retain all keys/references until a later cleanup worker confirms deletion. No TTL indexes here.
