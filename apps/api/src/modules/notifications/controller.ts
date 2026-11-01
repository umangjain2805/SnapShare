import type { Request, Response } from 'express';
import { z } from 'zod';
import { createNotificationService } from './service.js';
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
export function createNotificationController() {
  const service = createNotificationService();
  return {
    list: async (req: Request, res: Response) => { res.json(await service.list(res.locals.ownerId as string, req.query.before === undefined ? undefined : objectId.parse(req.query.before))); },
    read: async (req: Request, res: Response) => { await service.read(res.locals.ownerId as string, objectId.parse(req.params.id)); res.sendStatus(204); },
  };
}
