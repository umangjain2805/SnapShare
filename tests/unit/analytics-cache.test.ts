import { expect, it } from 'vitest';
import { createAnalyticsService } from '../../apps/api/src/modules/analytics/service.js';
import type { AnalyticsResult } from '../../packages/contracts/src/index.js';
it('coalesces matching reads, separates owner/period keys and expires cached metrics', async () => {
  let calls = 0; let now = 0;
  const service = createAnalyticsService(async () => { calls++; return { sampledAt: String(now) } as AnalyticsResult; }, () => now);
  await Promise.all([service.read('a', 7), service.read('a', 7)]); expect(calls).toBe(1);
  await service.read('b', 7); await service.read('a', 30); expect(calls).toBe(3);
  now = 5001; expect((await service.read('a', 7)).sampledAt).toBe('5001'); expect(calls).toBe(4);
});
