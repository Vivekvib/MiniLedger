import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { Errors } from '../utils/errors';

function toFieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'body';
    // Keep the first message per field; it is the most specific.
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/** Validates and replaces `req.body` with the parsed (trimmed, normalised) value. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(Errors.validation(toFieldErrors(result.error.issues)));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Validates `req.params`. The parsed values are not written back; handlers re-read params. */
export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(Errors.validation(toFieldErrors(result.error.issues)));
      return;
    }
    next();
  };
}
