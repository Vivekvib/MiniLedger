import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../utils/logger';
import { AppError } from '../utils/errors';

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
  type?: string;
  status?: number;
  stack?: string;
}

/** Network or server-availability failures from the pg driver and PostgreSQL itself. */
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

function isDbUnavailable(err: ErrorLike): boolean {
  if (err.code && (DB_UNAVAILABLE_CODES.has(err.code) || err.code.startsWith('08'))) return true;
  return typeof err.message === 'string' && /timeout exceeded when trying to connect|Connection terminated/i.test(err.message);
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}.`));
};

/**
 * The only place that writes error responses. It never forwards stack traces, SQL text or
 * driver messages to the client; those go to the server log only.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof AppError) {
      if (err.headers) res.set(err.headers);
      res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
      return;
    }

    const e = (typeof err === 'object' && err !== null ? err : {}) as ErrorLike;

    // express.json() failures.
    if (e.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
      return;
    }
    if (e.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
      return;
    }

    // Log name, code, message and stack only: pg error objects can carry row data in `detail`.
    logger.error(
      { errName: e.name, errCode: e.code, errMessage: e.message, stack: e.stack, method: req.method, path: req.path },
      'request failed',
    );

    if (isDbUnavailable(e)) {
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable. Please try again shortly.' },
      });
      return;
    }

    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
  };
}
