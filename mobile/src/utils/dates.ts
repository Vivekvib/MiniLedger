/**
 * Date helpers. Due dates are calendar dates ("2026-11-01") with no time zone, so they are
 * handled as strings and formatted from their parts. Nothing here ever goes through
 * `toISOString()` or `new Date("YYYY-MM-DD")`, both of which work in UTC and can shift the day
 * for users east or west of Greenwich (IST users would see the wrong date near midnight).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A local calendar date as "YYYY-MM-DD", read from local (not UTC) components. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Parses "YYYY-MM-DD" into a Date at LOCAL midnight, or null if it is not a real calendar date. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return real ? date : null;
}

/** "2026-11-01" -> "1 Nov 2026". Returns the input unchanged if it is not a valid date. */
export function formatDueDate(value: string): string {
  const date = parseIsoDate(value);
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : value;
}

/** An ISO timestamp (such as `repaidAt`) shown as the viewer's local calendar date: "14 Oct 2026". */
export function formatInstantDate(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The suggested due date: `days` from today in the viewer's local calendar. */
export function defaultDueDate(now: Date = new Date(), days = 7): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}
