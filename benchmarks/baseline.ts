// Benchmark-only uncached candidate: project owner records, then reduce them in JavaScript.
// This is never mounted by the production application.
import { Share, TransferTicket, UploadSession, Snippet, AssetQuota } from '../packages/backend/dist/index.js';
import type { AnalyticsResult } from '../packages/contracts/src/index.js';
export async function baselineAnalytics(ownerId: string, days: number): Promise<AnalyticsResult> {
  const now = new Date();
  const [shares, uploads, snippets, quota] = await Promise.all([
    Share.find({ ownerId }).select('_id createdAt expiresAt status downloadCount cleanupStatus').lean(),
    UploadSession.find({ ownerId }).select('createdAt size status scanStatus cleanupStatus cleanupFailedAt').lean(),
    Snippet.countDocuments({ ownerId, cleanupStatus: { $ne: 'deleted' } }), AssetQuota.findById(ownerId).lean(),
  ]);
  const tickets = await TransferTicket.find({ shareId: { $in: shares.map(s => s._id.toString()) } }).select('createdAt delivery').lean();
  const count = (predicate: (s: typeof shares[number]) => boolean) => shares.filter(predicate).length;
  const activity: AnalyticsResult['activity'] = [];
  for (let i = days - 1; i >= 0; i--) { const date = new Date(now); date.setUTCDate(date.getUTCDate() - i); const key = date.toISOString().slice(0, 10); activity.push({ date: key, uploads: uploads.filter(u => u.createdAt.toISOString().startsWith(key)).length, shares: shares.filter(s => s.createdAt.toISOString().startsWith(key)).length, claims: tickets.filter(t => t.createdAt.toISOString().startsWith(key)).length, failedTransfers: tickets.filter(t => t.createdAt.toISOString().startsWith(key) && t.delivery === 'failed').length }); }
  return { sampledAt: now.toISOString(), days, totals: { uploads: uploads.length, snippets, shares: shares.length, claims: shares.reduce((n, s) => n + s.downloadCount, 0), activeShares: count(s => s.status === 'active' && s.expiresAt > now), expired: count(s => s.expiresAt <= now), revoked: count(s => s.status === 'revoked'), failedTransfers: tickets.filter(t => t.delivery === 'failed').length, finishedTransfers: tickets.filter(t => t.delivery === 'finished').length, cleanupComplete: count(s => s.cleanupStatus === 'complete'), cleanupPending: count(s => s.cleanupStatus !== 'complete' && (s.status !== 'active' || s.expiresAt <= now)), pendingScan: uploads.filter(u => u.status === 'quarantined' && u.scanStatus === 'pending' && u.cleanupStatus !== 'deleted').length, cleanupFailures: uploads.filter(u => u.cleanupStatus === 'deleting' && u.cleanupFailedAt).length }, storage: { reservedBytes: quota?.bytes ?? 0, storedBytes: uploads.filter(u => u.status === 'quarantined' && u.cleanupStatus !== 'deleted').reduce((n, u) => n + u.size, 0), limitBytes: 1073741824, items: quota?.items ?? 0, limitItems: 100 }, activity };
}
