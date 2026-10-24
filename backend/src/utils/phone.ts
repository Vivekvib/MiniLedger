const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises a phone number to E.164 (`+` followed by 8-15 digits, first digit non-zero).
 * Spaces, hyphens, dots and parentheses are stripped. Returns null if invalid.
 *
 * Validation is deliberately syntactic: it does not enforce country-specific numbering
 * plans, so the assignment's example number `+911234567890` is accepted.
 */
export function normalizePhone(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s\-().]/g, '');
  return E164.test(stripped) ? stripped : null;
}

/** `+911234567890` -> `+91••••••7890`. Used for logs and the dev OTP console line. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '••••';
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}
