import { Schema, model } from 'mongoose';
import { lifecycleFields } from './lifecycle.js';
const uploadSchema = new Schema({
  ...lifecycleFields,
  ownerId: { type: String, required: true, index: true },
  filename: { type: String, required: true }, size: { type: Number, required: true }, mimeType: { type: String, required: true }, fingerprint: { type: String, required: true },
  objectKey: { type: String, required: true, unique: true }, storageUploadId: String,
  status: { type: String, enum: ['initializing', 'uploading', 'completing', 'quarantined', 'aborting', 'aborted'], required: true },
  scanStatus: { type: String, enum: ['pending', 'clean', 'rejected'], default: 'pending', required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
uploadSchema.index({ ownerId: 1, createdAt: -1 });
uploadSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
uploadSchema.index({ cleanupStatus: 1, expiresAt: 1 });
export const UploadSession = model('UploadSession', uploadSchema);
const snippetSchema = new Schema({ ...lifecycleFields, ownerId: { type: String, required: true, index: true }, title: { type: String, required: true }, language: { type: String, required: true }, text: { type: String, required: true } }, { timestamps: true });
snippetSchema.index({ purgeAfter: 1 }, { expireAfterSeconds: 0 });
export const Snippet = model('Snippet', snippetSchema);
export const AssetQuota = model('AssetQuota', new Schema({ _id: String, bytes: { type: Number, default: 0, required: true }, items: { type: Number, default: 0, required: true }, shareVersion: { type: Number, default: 0 } }));
