/**
 * Money helpers. Amounts are exact decimal STRINGS end to end ("1500.00"): the database stores
 * NUMERIC(12,2), the API sends strings, and the app never converts them to floating point, so
 * there is no rounding error to introduce. Formatting is plain string manipulation, which also
 * keeps it identical on every JS engine (no dependence on Intl support in Hermes).
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Indian digit grouping: the last three digits, then groups of two ("1,50,000"). */
export function groupIndian(integerDigits: string): string {
  const digits = integerDigits.replace(/^0+(?=\d)/, '');
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

/** "150000" or "150000.5" -> "₹1,50,000.00". Anything that is not a decimal string is returned unchanged. */
export function formatInr(amount: string): string {
  const match = DECIMAL.exec(amount.trim());
  if (!match) return amount;
  const [, sign = '', integer = '0', fraction = ''] = match;
  return `${sign}₹${groupIndian(integer)}.${fraction.padEnd(2, '0')}`;
}

/** For screen readers: "₹1,500.00" would be read as a symbol, so spell the unit out. */
export function formatInrSpoken(amount: string): string {
  const match = DECIMAL.exec(amount.trim());
  if (!match) return amount;
  const [, sign = '', integer = '0', fraction = ''] = match;
  const cents = fraction.padEnd(2, '0');
  const number = `${sign}${groupIndian(integer)}${cents === '00' ? '' : `.${cents}`}`;
  return `${number} rupees`;
}

/** True when the decimal string is greater than zero. Pure string check, no parsing. */
export function isPositiveAmount(amount: string): boolean {
  return /[1-9]/.test(amount);
}

/**
 * Keeps only what an amount field can hold: digits and a single decimal point, with at most two
 * decimals. Commas and anything else are dropped as the user types.
 */
export function sanitizeAmountInput(raw: string): string {
  let out = '';
  let seenDot = false;
  let decimals = 0;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals += 1;
      }
      out += ch;
    } else if (ch === '.' && !seenDot) {
      seenDot = true;
      out += ch;
    }
  }
  return out;
}

export type AmountResult = { ok: true; value: string } | { ok: false; message: string };

export const AMOUNT_MESSAGES = {
  required: 'Enter the amount you lent.',
  format: 'Enter an amount with at most 2 decimal places, for example 1500 or 1500.50.',
  notPositive: 'Amount must be greater than 0.',
  tooLarge: 'Amount can have at most 10 digits before the decimal point.',
} as const;

/** Validates and normalises what the user typed ("5." -> "5", ".5" -> "0.5"). */
export function parseAmountInput(raw: string): AmountResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, message: AMOUNT_MESSAGES.required };

  let text = trimmed;
  if (text.startsWith('.')) text = `0${text}`;
  if (text.endsWith('.')) text = text.slice(0, -1);

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false, message: AMOUNT_MESSAGES.format };
  const integer = (match[1] ?? '').replace(/^0+(?=\d)/, '');
  if (integer.length > 10) return { ok: false, message: AMOUNT_MESSAGES.tooLarge };
  if (!isPositiveAmount(text)) return { ok: false, message: AMOUNT_MESSAGES.notPositive };

  return { ok: true, value: match[2] === undefined ? integer : `${integer}.${match[2]}` };
}
