import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    if (error instanceof ZodError) { res.status(400).json({ error: 'Invalid request', fields: error.issues.map(i => i.path.join('.')) }); return; }
    if (error instanceof AppError) { res.status(error.status).json({ error: error.message }); return; }
    if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.parse.failed') { res.status(400).json({ error: 'Invalid JSON' }); return; }
      if (error.type === 'entity.too.large') { res.status(413).json({ error: 'Request too large' }); return; }
    }
    // Never log request bodies, cookie headers, database errors or credential values.
    logger.error({ event: 'request_failed' }, 'Unhandled request error');
    res.status(500).json({ error: 'Something went wrong' });
  };
}
