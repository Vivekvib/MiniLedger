/**
 * Money is handled as decimal strings end to end. It is never parsed into a JavaScript
 * number for arithmetic: PostgreSQL NUMERIC(12,2) does all summing.
 */

const AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

export type AmountParseResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'required' | 'not_positive' | 'format' };

/**
 * Normalises an incoming amount to a fixed two-decimal string such as `"1500.00"`.
 *
 * Accepts a decimal string or a JSON number (the assignment's example sends `1500`).
 * A JSON number is converted with `String()`, which round-trips the shortest decimal
 * form, so `1500.5` becomes `"1500.5"`; values like `0.30000000000000004` are rejected
 * by the two-decimal rule instead of being silently rounded.
 */
export function parseAmount(input: unknown): AmountParseResult {
  if (input === undefined || input === null || input === '') {
    return { ok: false, reason: 'required' };
  }

  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, reason: 'format' };
    text = String(input);
  } else if (typeof input === 'string') {
    text = input.trim();
  } else {
    return { ok: false, reason: 'format' };
  }

  // Negative numbers, and zero in any spelling ("0", "0.00", "-0").
  if (/^-\d/.test(text) || /^0+(\.0+)?$/.test(text)) {
    return { ok: false, reason: 'not_positive' };
  }

  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return { ok: false, reason: 'format' };

  const whole = (match[1] ?? '0').replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return { ok: true, value: `${whole}.${fraction}` };
}
