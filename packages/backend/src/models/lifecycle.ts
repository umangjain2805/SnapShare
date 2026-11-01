export const lifecycleFields = {
  cleanupStatus: { type: String, enum: ['active', 'deleting', 'deleted'], default: 'active', required: true },
  cleanupAttempts: { type: Number, default: 0 }, cleanupFailedAt: Date,
  cleanupLease: String, cleanupLeaseUntil: Date, deletedAt: Date, purgeAfter: Date,
  quotaReleased: { type: Boolean, default: false }, referenceVersion: { type: Number, default: 0 },
  lastCleanupQueuedAt: Date,
};
export const availableAsset = { cleanupStatus: { $nin: ['deleting', 'deleted'] } };
