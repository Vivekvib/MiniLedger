import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** A uniformly random 6-digit code from the OS CSPRNG, zero-padded ("004217"). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * HMAC-SHA256 over `phone:otp`, keyed with a server-side secret.
 *
 * A bare hash of a 6-digit code could be brute-forced offline in microseconds by anyone who
 * read the table. Keying it with OTP_HMAC_SECRET (which never enters the database) removes
 * that option; binding the phone stops a hash being replayed against another number.
 */
export function hashOtp(secret: string, phone: string, otp: string): string {
  return createHmac('sha256', secret).update(`${phone}:${otp}`).digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function hashesMatch(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
