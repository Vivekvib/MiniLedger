/**
 * Every failed API call surfaces as an ApiError, so screens handle one shape whether the cause
 * was the network, a timeout, a validation problem or a server error.
 *
 * status 0 means the request never got a response (offline, server down, timeout).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** No response at all: offline, unreachable server, or timeout. */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Per-field messages from a 400 VALIDATION_ERROR, e.g. { amount: "Amount must be greater than 0." }. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details?.fields;
    if (typeof fields !== 'object' || fields === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  /** Seconds to wait, from a 429 response. */
  get retryAfterSeconds(): number | null {
    const value = this.details?.retryAfterSeconds;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** Attempts left on a wrong one-time code, from a 401 INVALID_OTP. */
  get attemptsRemaining(): number | null {
    const value = this.details?.attemptsRemaining;
    return typeof value === 'number' ? value : null;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/**
 * A short sentence for the UI. Prefers the server's own message (they are written for users),
 * adding the wait time for rate limits.
 */
export function describeError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!isApiError(error)) return fallback;
  if (error.isNetwork) return error.message;
  const wait = error.retryAfterSeconds;
  if (error.status === 429 && wait !== null) {
    return `${error.message} Try again in ${formatWait(wait)}.`;
  }
  return error.message || fallback;
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.ceil(seconds))} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
