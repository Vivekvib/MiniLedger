import { colors } from '../src/theme';

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('Paper & Ink contrast (WCAG)', () => {
  // Text must reach 4.5:1 (AA) on every surface it sits on.
  it.each([
    ['text on background', colors.text, colors.background],
    ['text on surface', colors.text, colors.surface],
    ['secondary text on background', colors.textSecondary, colors.background],
    ['secondary text on surface', colors.textSecondary, colors.surface],
    ['accent text on background', colors.accent, colors.background],
    ['accent text on surface', colors.accent, colors.surface],
    ['accent text on pressed fill', colors.accent, colors.pressedFill],
    ['text on accent button', colors.onAccent, colors.accent],
    ['text on pressed accent button', colors.onAccent, colors.accentPressed],
    ['overdue text on background', colors.overdue, colors.background],
    ['overdue text on surface', colors.overdue, colors.surface],
  ])('%s is at least 4.5:1', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  // Component boundaries must reach 3:1 (WCAG 1.4.11).
  it.each([
    ['input border on background', colors.inputBorder, colors.background],
    ['input border on surface', colors.inputBorder, colors.surface],
    ['focus ring on surface', colors.accent, colors.surface],
    ['error border on surface', colors.overdue, colors.surface],
  ])('%s is at least 3:1', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the two functional colours distinguishable by lightness, not only hue', () => {
    // Red and green of similar lightness look the same in common colour blindness. Overdue and
    // accent differ in luminance, and every state also carries a text label regardless.
    expect(Math.abs(luminance(colors.overdue) - luminance(colors.accent))).toBeGreaterThan(0.02);
  });
});
