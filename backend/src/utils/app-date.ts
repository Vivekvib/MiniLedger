const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Throws if `timeZone` is not a valid IANA zone name. Used for startup validation. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    getFormatter(timeZone);
  } catch {
    throw new Error(`APP_TIMEZONE "${timeZone}" is not a valid IANA time zone (e.g. Asia/Kolkata).`);
  }
}

/**
 * The calendar date (`YYYY-MM-DD`) at `instant` in the application's time zone.
 *
 * This is the "today" used for every overdue decision. Due dates are date-only values
 * with no time zone, so they are compared against this string-shaped date rather than
 * against a timestamp.
 */
export function toAppDate(instant: Date, timeZone: string): string {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const pick = (type: 'year' | 'month' | 'day'): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Could not format ${type} for time zone ${timeZone}`);
    return part.value;
  };
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30, 2026-13-01 ...). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Accepted due-date range, to keep obviously wrong years (0001, 9999) out of the ledger. */
export const MIN_DUE_YEAR = 2000;
export const MAX_DUE_YEAR = 2100;

export function isDueDateInSupportedRange(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return year >= MIN_DUE_YEAR && year <= MAX_DUE_YEAR;
}
