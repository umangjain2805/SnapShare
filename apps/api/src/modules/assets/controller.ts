import type { Request, Response } from 'express';
import { uploadInputSchema, partInputSchema, snippetInputSchema } from '@snapshare/contracts';
import type { AssetService } from './service.js';
export function createAssetController(service: AssetService) {
  const owner = (res: Response) => res.locals.ownerId as string;
  const id = (req: Request) => String(req.params.id);
  return {
    list: async (_req: Request, res: Response) => { res.json({ uploads: await service.list(owner(res)) }); },
    initiate: async (req: Request, res: Response) => { res.status(201).json({ upload: await service.initiate(owner(res), uploadInputSchema.parse(req.body)) }); },
    get: async (req: Request, res: Response) => { res.json({ upload: await service.get(owner(res), id(req)) }); },
    sign: async (req: Request, res: Response) => { res.json(await service.sign(owner(res), id(req), partInputSchema.parse(req.body).partNumber)); },
    complete: async (req: Request, res: Response) => { res.json({ upload: await service.complete(owner(res), id(req)) }); },
    abort: async (req: Request, res: Response) => { await service.abort(owner(res), id(req)); res.sendStatus(204); },
    snippets: async (_req: Request, res: Response) => { res.json({ snippets: await service.snippets(owner(res)) }); },
    createSnippet: async (req: Request, res: Response) => { res.status(201).json({ snippet: await service.createSnippet(owner(res), snippetInputSchema.parse(req.body)) }); },
  };
}
