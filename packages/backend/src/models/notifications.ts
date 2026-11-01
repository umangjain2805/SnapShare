import { Schema, model } from 'mongoose';
const schema = new Schema({
  ownerId: { type: String, required: true }, sourceEventId: { type: String, required: true, unique: true },
  shareId: { type: String, required: true }, message: { type: String, required: true }, readAt: Date,
  emailStatus: { type: String, enum: ['disabled', 'pending', 'sending', 'sent', 'failed'], default: 'disabled', required: true },
  emailLeaseUntil: Date, emailLease: String, emailAttempts: { type: Number, default: 0 }, emailSentAt: Date,
}, { timestamps: true });
schema.index({ ownerId: 1, _id: -1 });
export const Notification = model('Notification', schema);
