import {
  formatInr,
  formatInrSpoken,
  groupIndian,
  isPositiveAmount,
  parseAmountInput,
  sanitizeAmountInput,
} from '../../src/utils/money';

describe('formatInr (Indian digit grouping, exact decimal strings)', () => {
  it.each([
    ['0.00', '₹0.00'],
    ['0', '₹0.00'],
    ['5', '₹5.00'],
    ['999.99', '₹999.99'],
    ['1000.00', '₹1,000.00'],
    ['1500.5', '₹1,500.50'],
    ['99999.99', '₹99,999.99'],
    ['100000.00', '₹1,00,000.00'],
    ['150000.00', '₹1,50,000.00'],
    ['1234567.89', '₹12,34,567.89'],
    ['10000000.00', '₹1,00,00,000.00'],
    ['9999999999.99', '₹9,99,99,99,999.99'],
    ['29999999999.97', '₹29,99,99,99,999.97'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatInr(input)).toBe(expected);
  });

  it('never goes through floating point: a value that floats cannot hold stays exact', () => {
    // 9007199254740993 is not representable as a double; the string path keeps every digit.
    expect(formatInr('9007199254740993.01')).toBe('₹9,00,71,99,25,47,40,993.01');
  });

  it('returns input that is not a decimal string unchanged', () => {
    expect(formatInr('abc')).toBe('abc');
    expect(formatInr('')).toBe('');
  });

  it('formats a negative amount with the sign before the rupee symbol', () => {
    expect(formatInr('-1500.00')).toBe('-₹1,500.00');
  });
});

describe('groupIndian', () => {
  it('groups the last three digits, then pairs', () => {
    expect(groupIndian('1')).toBe('1');
    expect(groupIndian('123')).toBe('123');
    expect(groupIndian('1234')).toBe('1,234');
    expect(groupIndian('12345678')).toBe('1,23,45,678');
  });
});

describe('formatInrSpoken', () => {
  it('spells out the unit and drops zero decimals', () => {
    expect(formatInrSpoken('1500.00')).toBe('1,500 rupees');
    expect(formatInrSpoken('150000.00')).toBe('1,50,000 rupees');
    expect(formatInrSpoken('250.50')).toBe('250.50 rupees');
  });
});

describe('isPositiveAmount', () => {
  it('is true only when a non-zero digit is present', () => {
    expect(isPositiveAmount('0.00')).toBe(false);
    expect(isPositiveAmount('0')).toBe(false);
    expect(isPositiveAmount('0.01')).toBe(true);
    expect(isPositiveAmount('250.50')).toBe(true);
  });
});

describe('sanitizeAmountInput', () => {
  it.each([
    ['1500', '1500'],
    ['1,500', '1500'],
    ['15.5', '15.5'],
    ['15.567', '15.56'],
    ['1.2.3', '1.23'],
    ['abc12', '12'],
    ['₹ 99', '99'],
    ['.5', '.5'],
    ['', ''],
  ])('turns %j into %j', (raw, expected) => {
    expect(sanitizeAmountInput(raw)).toBe(expected);
  });
});

describe('parseAmountInput', () => {
  it.each([
    ['1500', '1500'],
    ['1500.5', '1500.5'],
    ['1500.50', '1500.50'],
    ['  75  ', '75'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['007', '7'],
    ['9999999999.99', '9999999999.99'],
  ])('accepts %j as %j', (raw, value) => {
    expect(parseAmountInput(raw)).toEqual({ ok: true, value });
  });

  it('rejects an empty amount with a "required" message', () => {
    expect(parseAmountInput('   ')).toMatchObject({ ok: false, message: expect.stringMatching(/enter the amount/i) });
  });

  it.each(['0', '0.00', '.0', '000'])('rejects %j as not greater than zero', (raw) => {
    expect(parseAmountInput(raw)).toMatchObject({ ok: false, message: 'Amount must be greater than 0.' });
  });

  it.each(['1.234', 'abc', '1e3', '-5', '1,5', '1..2'])('rejects %j as malformed', (raw) => {
    expect(parseAmountInput(raw)).toMatchObject({ ok: false, message: expect.stringMatching(/2 decimal places/) });
  });

  it('rejects more than ten digits before the decimal point', () => {
    expect(parseAmountInput('12345678901')).toMatchObject({ ok: false, message: expect.stringMatching(/10 digits/) });
  });
});
