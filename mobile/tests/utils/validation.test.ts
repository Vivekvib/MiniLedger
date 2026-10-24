import { toIsoDate } from '../../src/utils/dates';
import { FRIEND_NAME_MAX, validateLoanForm } from '../../src/utils/validation';

const valid = { friendName: 'Example Friend', amountText: '1500', dueDate: new Date(2026, 10, 1) };

describe('validateLoanForm', () => {
  it('returns the exact payload the API expects', () => {
    expect(validateLoanForm(valid)).toEqual({
      ok: true,
      input: { friendName: 'Example Friend', amount: '1500', dueDate: '2026-11-01' },
    });
  });

  it('trims the name and normalises the amount', () => {
    const result = validateLoanForm({ ...valid, friendName: '  Asha  ', amountText: '.5' });
    expect(result).toEqual({ ok: true, input: { friendName: 'Asha', amount: '0.5', dueDate: '2026-11-01' } });
  });

  it('uses the local calendar date for the due date (no UTC shift)', () => {
    const result = validateLoanForm({ ...valid, dueDate: new Date(2026, 10, 1, 0, 15) });
    expect(result).toMatchObject({ ok: true, input: { dueDate: '2026-11-01' } });
    expect(toIsoDate(new Date(2026, 10, 1, 0, 15))).toBe('2026-11-01');
  });

  it('rejects an empty or whitespace-only name next to the name field', () => {
    for (const friendName of ['', '   ']) {
      const result = validateLoanForm({ ...valid, friendName });
      expect(result).toEqual({ ok: false, errors: { friendName: "Enter your friend's name." } });
    }
  });

  it('rejects a name longer than the maximum, and accepts one at the maximum', () => {
    expect(validateLoanForm({ ...valid, friendName: 'x'.repeat(FRIEND_NAME_MAX + 1) })).toMatchObject({
      ok: false,
      errors: { friendName: expect.stringMatching(/80 characters/) },
    });
    expect(validateLoanForm({ ...valid, friendName: 'x'.repeat(FRIEND_NAME_MAX) }).ok).toBe(true);
  });

  it('rejects control characters in the name', () => {
    expect(validateLoanForm({ ...valid, friendName: 'Bad\u0007Name' })).toMatchObject({
      ok: false,
      errors: { friendName: 'Name contains invalid characters.' },
    });
  });

  it.each([
    ['', /enter the amount/i],
    ['0', /greater than 0/],
    ['0.00', /greater than 0/],
    ['-5', /2 decimal places/],
    ['1.234', /2 decimal places/],
    ['abc', /2 decimal places/],
  ])('rejects amount %j', (amountText, message) => {
    const result = validateLoanForm({ ...valid, amountText });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.amount).toMatch(message);
  });

  it('rejects an invalid date and a date outside 2000-2100', () => {
    expect(validateLoanForm({ ...valid, dueDate: new Date('nope') })).toMatchObject({
      ok: false,
      errors: { dueDate: 'Choose a due date.' },
    });
    expect(validateLoanForm({ ...valid, dueDate: new Date(1999, 11, 31) })).toMatchObject({
      ok: false,
      errors: { dueDate: expect.stringMatching(/between the years 2000 and 2100/) },
    });
    expect(validateLoanForm({ ...valid, dueDate: new Date(2101, 0, 1) }).ok).toBe(false);
  });

  it('allows a due date in the past (recording an already-overdue loan is a normal use)', () => {
    expect(validateLoanForm({ ...valid, dueDate: new Date(2026, 0, 1) }).ok).toBe(true);
  });

  it('reports every invalid field at once, one message each', () => {
    const result = validateLoanForm({ friendName: '', amountText: '0', dueDate: new Date(1990, 0, 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['amount', 'dueDate', 'friendName']);
  });
});
