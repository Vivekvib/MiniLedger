import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

/** Retry a failed read once, but only for trouble that might pass (network, 5xx), never for 4xx. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
  return true;
}

/**
 * Reads may retry once. Writes NEVER retry automatically: a flaky network must not be able to
 * create a loan twice. (The add-loan call also carries an Idempotency-Key as a second safeguard.)
 */
export function createQueryClient(options: { retryReads?: boolean } = {}): QueryClient {
  const { retryReads = true } = options;
  return new QueryClient({
    defaultOptions: {
      queries: { retry: retryReads ? shouldRetryQuery : false },
      mutations: { retry: false },
    },
  });
}
