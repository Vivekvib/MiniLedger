import { maskPhone, normalizePhone } from '../../src/utils/phone';

describe('normalizePhone', () => {
  it.each([
    ['+911234567890', '+911234567890'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['+1 (415) 555-0132', '+14155550132'],
    ['  +447911123456  ', '+447911123456'],
  ])('normalises %p', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([[''], ['9876543210'], ['+0911234567890'], ['+91'], ['+9112345'], ['+1234567890123456'], ['abc'], ['+91abc4567890']])(
    'rejects %p',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('maskPhone', () => {
  it('keeps the country prefix and last four digits', () => {
    expect(maskPhone('+911234567890')).toBe('+91••••••7890');
  });

  it('never reveals short values', () => {
    expect(maskPhone('+12345')).toBe('••••');
  });
});
