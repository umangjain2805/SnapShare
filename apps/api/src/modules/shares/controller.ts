import type { Request, Response, NextFunction } from 'express';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { createShareSchema, claimShareSchema, opaqueTokenSchema, shareListQuerySchema } from '@snapshare/contracts';
import type { ShareService } from './service.js';
import { AppError } from '../../middleware/errors.js';
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
export function createShareController(service: ShareService, appUrl: string) {
  const owner = (res: Response) => res.locals.ownerId as string;
  return {
    create: async (req: Request, res: Response) => {
      const result = await service.create(owner(res), createShareSchema.parse(req.body));
      res.status(201).json({ share: { id: result.id, url: `${appUrl}/s/${result.token}`, expiresAt: result.expiresAt } });
    },
    list: async (req: Request, res: Response) => { const query = shareListQuerySchema.parse(req.query); res.json(await service.list(owner(res), query.before, query.state)); },
    detail: async (req: Request, res: Response) => { res.json({ share: await service.detail(owner(res), objectId.parse(req.params.id)) }); },
    revoke: async (req: Request, res: Response) => { await service.revoke(owner(res), objectId.parse(req.params.id)); res.sendStatus(204); },
    metadata: (_req: Request, res: Response) => {
      // Identical for missing, expired and existing tokens. No title, filename, owner or status disclosed.
      res.json({ passwordRequired: true, expiresInHours: 24, maxDownloads: 1 });
    },
    claim: async (req: Request, res: Response) => { res.json(await service.claim(opaqueTokenSchema.parse(req.params.token), claimShareSchema.parse(req.body))); },
    transfer: async (req: Request, res: Response, next: NextFunction) => {
      if (req.get('range')) throw new AppError(416, 'Range downloads are not supported');
      const token = opaqueTokenSchema.parse(req.params.ticket);
      const abort = new AbortController();
      const disconnect = () => { if (!res.writableFinished) abort.abort(); };
      res.once('close', disconnect); req.once('aborted', disconnect);
      const timeout = setTimeout(() => abort.abort(), 300000).unref();
      let transferId: string | undefined;
      try {
        const transfer = await service.redeem(token, abort.signal); transferId = transfer.id;
        const filename = Buffer.from(transfer.filename, 'utf8').toString('utf8');
        const fallback = filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180) || 'download';
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`);
        res.setHeader('Content-Length', transfer.size);
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        res.setHeader('Accept-Ranges', 'none');
        let bytes = 0;
        const verifySize = new Transform({
          transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; callback(bytes > transfer.size ? new Error('Transfer size mismatch') : null, bytes > transfer.size ? undefined : chunk); },
          flush(callback) { callback(bytes === transfer.size ? null : new Error('Transfer size mismatch')); },
        });
        // pipeline propagates backpressure and disconnects to S3 without buffering the complete file.
        await pipeline(transfer.stream, verifySize, res, { signal: abort.signal });
        // A bookkeeping outage after a finished response must not label successfully streamed bytes as failed.
        await service.delivery(transferId, 'finished').catch(() => {});
      } catch (error) {
        if (transferId) await service.delivery(transferId, 'failed').catch(() => {});
        if (!res.headersSent && !res.destroyed) next(error);
        else if (!res.destroyed) res.destroy();
      } finally { clearTimeout(timeout); res.off('close', disconnect); req.off('aborted', disconnect); }
    },
  };
}
