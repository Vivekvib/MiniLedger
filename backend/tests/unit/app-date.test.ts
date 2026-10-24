import { assertValidTimeZone, isDueDateInSupportedRange, isValidIsoDate, toAppDate } from '../../src/utils/app-date';

describe('toAppDate (Asia/Kolkata, UTC+05:30)', () => {
  const tz = 'Asia/Kolkata';

  it('is still the same day one second before IST midnight', () => {
    expect(toAppDate(new Date('2026-10-31T18:29:59.000Z'), tz)).toBe('2026-10-31');
  });

  it('rolls over exactly at IST midnight', () => {
    expect(toAppDate(new Date('2026-10-31T18:30:00.000Z'), tz)).toBe('2026-11-01');
  });

  it('differs from the UTC date during the first 5.5 hours of the IST day', () => {
    const instant = new Date('2026-10-31T20:00:00.000Z'); // 01:30 on 1 Nov in IST
    expect(instant.toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(toAppDate(instant, tz)).toBe('2026-11-01');
  });

  it('handles month and year rollover', () => {
    expect(toAppDate(new Date('2026-12-31T18:30:00.000Z'), tz)).toBe('2027-01-01');
  });
});

describe('toAppDate with other zones', () => {
  it('uses New York time (UTC-4 in October)', () => {
    expect(toAppDate(new Date('2026-10-15T03:59:59.000Z'), 'America/New_York')).toBe('2026-10-14');
    expect(toAppDate(new Date('2026-10-15T04:00:00.000Z'), 'America/New_York')).toBe('2026-10-15');
  });

  it('is independent of the process time zone', () => {
    // The helper takes the zone explicitly, so TZ cannot leak in.
    const before = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
    try {
      expect(toAppDate(new Date('2026-10-31T18:29:59.000Z'), 'Asia/Kolkata')).toBe('2026-10-31');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe('assertValidTimeZone', () => {
  it('accepts IANA zones', () => {
    expect(() => assertValidTimeZone('Asia/Kolkata')).not.toThrow();
    expect(() => assertValidTimeZone('UTC')).not.toThrow();
  });

  it('rejects unknown zones with a helpful message', () => {
    expect(() => assertValidTimeZone('Mars/Olympus')).toThrow(/not a valid IANA time zone/);
  });
});

describe('isValidIsoDate', () => {
  it.each(['2026-11-01', '2024-02-29', '2000-01-01', '2100-12-31'])('accepts %s', (value) => {
    expect(isValidIsoDate(value)).toBe(true);
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-11-00', '2026-1-1', '01/11/2026', '2026-11-01T00:00:00Z', '', 'tomorrow'])(
    'rejects %p',
    (value) => {
      expect(isValidIsoDate(value)).toBe(false);
    },
  );
});

describe('isDueDateInSupportedRange', () => {
  it('limits years to 2000-2100', () => {
    expect(isDueDateInSupportedRange('1999-12-31')).toBe(false);
    expect(isDueDateInSupportedRange('2000-01-01')).toBe(true);
    expect(isDueDateInSupportedRange('2100-12-31')).toBe(true);
    expect(isDueDateInSupportedRange('2101-01-01')).toBe(false);
  });
});
