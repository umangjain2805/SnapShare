import { readAnalytics } from './repository.js';
import type { AnalyticsResult } from '@snapshare/contracts';
import { AppError } from '../../middleware/errors.js';
export function createAnalyticsService(read = readAnalytics, clock = Date.now) {
  const cache = new Map<string, { until: number; value: AnalyticsResult }>();
  const pending = new Map<string, Promise<AnalyticsResult>>();
  return { async read(ownerId: string, days: number) {
    const key = `${ownerId}-${days}`; const found = cache.get(key);
    if (found && found.until > clock()) return found.value;
    const running = pending.get(key); if (running) return running;
    if (pending.size >= 100) throw new AppError(503, 'Analytics is busy. Try again shortly.');
    const operation = read(ownerId, days).then(value => {
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: clock() + 5000, value }); return value;
    }).finally(() => pending.delete(key));
    pending.set(key, operation); return operation;
  } };
}
