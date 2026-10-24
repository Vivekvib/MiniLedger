import { isValidOtp, normalizePhoneInput, sanitizeOtpInput } from '../../src/utils/phone';

describe('normalizePhoneInput', () => {
  it.each([
    ['+911234567890', '+911234567890'],
    ['+91 12345 67890', '+911234567890'],
    ['+91-12345-67890', '+911234567890'],
    ['(+91) 12345 67890', '+911234567890'],
    ['1234567890', '+911234567890'],
    ['01234567890', '+911234567890'],
    ['91 1234567890', '+911234567890'],
    ['  9876543210  ', '+919876543210'],
    ['+14155552671', '+14155552671'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizePhoneInput(raw)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '12345',
    'abcdefghij',
    '+0123456789',
    '+12',
    '+1234567890123456',
    '123456789012345678',
    '98765 4321',
  ])('rejects %j', (raw) => {
    expect(normalizePhoneInput(raw)).toBeNull();
  });
});

describe('one-time code helpers', () => {
  it('keeps only digits, at most six', () => {
    expect(sanitizeOtpInput('12a3 45-67')).toBe('123456');
    expect(sanitizeOtpInput('')).toBe('');
  });

  it('accepts exactly six digits', () => {
    expect(isValidOtp('123456')).toBe(true);
    expect(isValidOtp('12345')).toBe(false);
    expect(isValidOtp('1234567')).toBe(false);
    expect(isValidOtp('12345a')).toBe(false);
  });
});
