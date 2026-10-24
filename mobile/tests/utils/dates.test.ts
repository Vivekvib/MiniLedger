import { defaultDueDate, formatDueDate, formatInstantDate, parseIsoDate, toIsoDate } from '../../src/utils/dates';

describe('toIsoDate (local calendar date, not UTC)', () => {
  it('keeps the local day when UTC is still on the previous day (the IST midnight trap)', () => {
    // 00:30 IST on 1 Nov is 19:00 UTC on 31 Oct. toISOString().slice(0, 10) would say 31 Oct.
    const justAfterMidnight = new Date(2026, 10, 1, 0, 30);
    expect(justAfterMidnight.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(toIsoDate(justAfterMidnight)).toBe('2026-11-01');
  });

  it('pads month and day', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('parseIsoDate', () => {
  it('parses a real date to local midnight', () => {
    const date = parseIsoDate('2026-11-01');
    expect(date).not.toBeNull();
    expect([date!.getFullYear(), date!.getMonth(), date!.getDate(), date!.getHours()]).toEqual([2026, 10, 1, 0]);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-1', '11/01/2026', '', 'not a date'])(
    'rejects %j',
    (value) => {
      expect(parseIsoDate(value)).toBeNull();
    },
  );

  it('handles leap days', () => {
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-02-29')).toBeNull();
  });
});

describe('formatDueDate', () => {
  it('formats a calendar date without time-zone shifting', () => {
    expect(formatDueDate('2026-11-01')).toBe('1 Nov 2026');
    expect(formatDueDate('2026-12-31')).toBe('31 Dec 2026');
    expect(formatDueDate('2026-01-09')).toBe('9 Jan 2026');
  });

  it('gives the same answer in a time zone west of UTC', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatDueDate('2026-11-01')).toBe('1 Nov 2026');
    } finally {
      process.env.TZ = original;
    }
  });

  it('returns invalid input unchanged', () => {
    expect(formatDueDate('2026-02-30')).toBe('2026-02-30');
  });
});

describe('formatInstantDate', () => {
  it("shows a timestamp as the viewer's local date", () => {
    // 20:00 UTC on 14 Oct is 01:30 on 15 Oct in IST.
    expect(formatInstantDate('2026-10-14T20:00:00.000Z')).toBe('15 Oct 2026');
    expect(formatInstantDate('2026-10-14T10:00:00.000Z')).toBe('14 Oct 2026');
  });

  it('returns an unparseable value unchanged', () => {
    expect(formatInstantDate('garbage')).toBe('garbage');
  });
});

describe('defaultDueDate', () => {
  it('is seven days from today by default, in the local calendar', () => {
    expect(toIsoDate(defaultDueDate(new Date(2026, 9, 21, 15, 30)))).toBe('2026-10-28');
  });

  it('rolls over month and year ends', () => {
    expect(toIsoDate(defaultDueDate(new Date(2026, 9, 28)))).toBe('2026-11-04');
    expect(toIsoDate(defaultDueDate(new Date(2026, 11, 28)))).toBe('2027-01-04');
  });

  it('accepts a custom number of days', () => {
    expect(toIsoDate(defaultDueDate(new Date(2026, 9, 21), 30))).toBe('2026-11-20');
  });
});
