import { randomUUID } from 'expo-crypto';

/** A fresh random UUID (v4) for the Idempotency-Key header on POST /api/loans. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
