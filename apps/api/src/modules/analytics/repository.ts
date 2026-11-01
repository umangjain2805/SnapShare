import { Share, UploadSession, Snippet, AssetQuota } from '@snapshare/backend';
import type { PipelineStage } from 'mongoose';
import type { AnalyticsResult } from '@snapshare/contracts';
type Counts = Record<string, number>;
type Day = { _id: string; uploads?: number; shares?: number; claims?: number; failedTransfers?: number };
const sumIf = (expression: object) => ({ $sum: { $cond: [expression, 1, 0] } });
export async function readAnalytics(ownerId: string, days: number): Promise<AnalyticsResult> {
  const now = new Date(); const since = new Date(now); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - days + 1);
  const sharePipeline: PipelineStage[] = [
    { $match: { ownerId } },
    { $lookup: { from: 'transfertickets', let: { share: { $toString: '$_id' } }, pipeline: [{ $match: { $expr: { $eq: ['$shareId', '$$share'] } } }, { $project: { delivery: 1, createdAt: 1 } }], as: 'transfer' } },
    { $set: { ticket: { $first: '$transfer' } } },
    { $facet: {
      totals: [{ $group: { _id: null, shares: { $sum: 1 }, claims: { $sum: '$downloadCount' }, activeShares: sumIf({ $and: [{ $eq: ['$status', 'active'] }, { $gt: ['$expiresAt', now] }] }), expired: sumIf({ $lte: ['$expiresAt', now] }), revoked: sumIf({ $eq: ['$status', 'revoked'] }), failedTransfers: sumIf({ $eq: ['$ticket.delivery', 'failed'] }), finishedTransfers: sumIf({ $eq: ['$ticket.delivery', 'finished'] }), cleanupComplete: sumIf({ $eq: ['$cleanupStatus', 'complete'] }), cleanupPending: sumIf({ $and: [{ $ne: ['$cleanupStatus', 'complete'] }, { $or: [{ $ne: ['$status', 'active'] }, { $lte: ['$expiresAt', now] }] }] }) } }, { $project: { _id: 0 } }],
      activity: [{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, shares: { $sum: 1 } } }],
      claims: [{ $match: { 'ticket.createdAt': { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ticket.createdAt', timezone: 'UTC' } }, claims: { $sum: 1 }, failedTransfers: sumIf({ $eq: ['$ticket.delivery', 'failed'] }) } }],
    } },
  ];
  const [shares, uploads, snippets, quota] = await Promise.all([
    Share.aggregate<{ totals: Counts[]; activity: Day[]; claims: Day[] }>(sharePipeline).option({ maxTimeMS: 5000 }),
    UploadSession.aggregate<{ totals: Counts[]; activity: Day[] }>([{ $match: { ownerId } }, { $facet: {
      totals: [{ $group: { _id: null, uploads: { $sum: 1 }, storedBytes: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'quarantined'] }, { $ne: ['$cleanupStatus', 'deleted'] }] }, '$size', 0] } }, pendingScan: sumIf({ $and: [{ $eq: ['$status', 'quarantined'] }, { $eq: ['$scanStatus', 'pending'] }, { $ne: ['$cleanupStatus', 'deleted'] }] }), cleanupFailures: sumIf({ $and: [{ $eq: ['$cleanupStatus', 'deleting'] }, { $ne: [{ $ifNull: ['$cleanupFailedAt', null] }, null] }] }) } }, { $project: { _id: 0 } }],
      activity: [{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, uploads: { $sum: 1 } } }],
    } }]).option({ maxTimeMS: 5000 }),
    Snippet.countDocuments({ ownerId, cleanupStatus: { $ne: 'deleted' } }), AssetQuota.findById(ownerId).lean(),
  ]);
  const shareTotals = shares[0]?.totals[0] ?? {}; const uploadTotals = uploads[0]?.totals[0] ?? {};
  const activity: AnalyticsResult['activity'] = [];
  for (let i = 0; i < days; i++) { const date = new Date(since); date.setUTCDate(date.getUTCDate() + i); const key = date.toISOString().slice(0, 10); activity.push({ date: key, uploads: uploads[0]?.activity.find(d => d._id === key)?.uploads ?? 0, shares: shares[0]?.activity.find(d => d._id === key)?.shares ?? 0, claims: shares[0]?.claims.find(d => d._id === key)?.claims ?? 0, failedTransfers: shares[0]?.claims.find(d => d._id === key)?.failedTransfers ?? 0 }); }
  return { sampledAt: now.toISOString(), days, totals: { uploads: uploadTotals.uploads ?? 0, snippets, shares: shareTotals.shares ?? 0, claims: shareTotals.claims ?? 0, activeShares: shareTotals.activeShares ?? 0, expired: shareTotals.expired ?? 0, revoked: shareTotals.revoked ?? 0, failedTransfers: shareTotals.failedTransfers ?? 0, finishedTransfers: shareTotals.finishedTransfers ?? 0, cleanupPending: shareTotals.cleanupPending ?? 0, cleanupComplete: shareTotals.cleanupComplete ?? 0, pendingScan: uploadTotals.pendingScan ?? 0, cleanupFailures: uploadTotals.cleanupFailures ?? 0 }, storage: { reservedBytes: quota?.bytes ?? 0, storedBytes: uploadTotals.storedBytes ?? 0, limitBytes: 1073741824, items: quota?.items ?? 0, limitItems: 100 }, activity };
}
