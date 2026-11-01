import type { Request, Response } from 'express';
import { analyticsQuerySchema } from '@snapshare/contracts';
import { createAnalyticsService } from './service.js';
export function createAnalyticsController() {
  const service = createAnalyticsService();
  return { get: async (req: Request, res: Response) => { const query = analyticsQuerySchema.parse(req.query); res.json(await service.read(res.locals.ownerId as string, Number(query.days))); } };
}
