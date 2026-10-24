import { parseAmount } from '../../src/utils/money';

describe('parseAmount', () => {
  it.each([
    ['1500', '1500.00'],
    [1500, '1500.00'],
    ['1500.5', '1500.50'],
    [1500.5, '1500.50'],
    ['0.01', '0.01'],
    ['0.30', '0.30'],
    ['  250.75  ', '250.75'],
    ['007', '7.00'],
    ['9999999999.99', '9999999999.99'],
  ])('accepts %p as %p', (input, expected) => {
    expect(parseAmount(input)).toEqual({ ok: true, value: expected });
  });

  it.each([[0], ['0'], ['0.00'], ['00.0'], [-5], ['-5'], ['-0.01'], [-0.5]])('rejects non-positive %p', (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, reason: 'not_positive' });
  });

  it.each([[undefined], [null], ['']])('reports %p as required', (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, reason: 'required' });
  });

  it.each([
    ['abc'],
    ['1,500'],
    ['1.234'],
    ['12345678901'], // 11 integer digits
    ['1e3'],
    ['.5'],
    ['5.'],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [0.1 + 0.2], // 0.30000000000000004: rejected, not silently rounded
    [1e21],
    [true],
    [{}],
    [[]],
  ])('rejects malformed %p', (input) => {
    expect(parseAmount(input)).toEqual({ ok: false, reason: 'format' });
  });
});
