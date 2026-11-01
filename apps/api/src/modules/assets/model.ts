import { Schema, model } from 'mongoose';
const uploadSchema = new Schema({
  ownerId: { type: String, required: true, index: true },
  filename: { type: String, required: true }, size: { type: Number, required: true }, mimeType: { type: String, required: true }, fingerprint: { type: String, required: true },
  objectKey: { type: String, required: true, unique: true }, storageUploadId: String,
  status: { type: String, enum: ['initializing', 'uploading', 'completing', 'quarantined', 'aborting', 'aborted'], required: true },
  scanStatus: { type: String, enum: ['pending', 'clean', 'rejected'], default: 'pending', required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
uploadSchema.index({ ownerId: 1, createdAt: -1 });
// No TTL: retain object keys and reserved quota until cleanup is confirmed.
export const UploadSession = model('UploadSession', uploadSchema);
export const Snippet = model('Snippet', new Schema({ ownerId: { type: String, required: true, index: true }, title: { type: String, required: true }, language: { type: String, required: true }, text: { type: String, required: true } }, { timestamps: true }));
export const AssetQuota = model('AssetQuota', new Schema({ _id: String, bytes: { type: Number, default: 0, required: true }, items: { type: Number, default: 0, required: true } }));
