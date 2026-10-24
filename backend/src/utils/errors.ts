/**
 * Every expected failure is an AppError. The central error handler turns it into
 * `{ error: { code, message, details? } }` with the right HTTP status.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation(fields: Record<string, string>): AppError {
    return new AppError(400, 'VALIDATION_ERROR', 'Invalid request.', { fields });
  },

  unauthorized(message = 'Authentication required. Please sign in again.'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  },

  notFound(message = 'Not found.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  },

  tooManyRequests(code: string, message: string, retryAfterSeconds: number): AppError {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    return new AppError(429, code, message, { retryAfterSeconds: seconds }, {
      'Retry-After': String(seconds),
    });
  },
};
