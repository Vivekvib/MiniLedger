/**
 * Paper & Ink colour tokens (the approved design direction).
 *
 * Only two functional colours exist: `accent` (green: primary actions, repaid) and `overdue`
 * (red: overdue and errors). State is never carried by colour alone; every coloured state also
 * has a text label. Contrast ratios are asserted in tests/theme.test.ts.
 */
export const colors = {
  /** Screen background. */
  background: '#F6F2E9',
  /** Inputs and banners. */
  surface: '#FCFAF4',
  /** Primary text and the double rule. */
  text: '#1D1B16',
  /** Dates, hints, labels. */
  textSecondary: '#5E584B',
  /** Primary button, repaid state, focus ring. */
  accent: '#1F4D3F',
  /** Text on an accent fill. */
  onAccent: '#FCFAF4',
  /** Pressed primary button. */
  accentPressed: '#173A30',
  /** Overdue text and rule, error borders and messages. */
  overdue: '#A12B24',
  /** Input outlines. */
  inputBorder: '#8A8370',
  /** Decorative hairlines. */
  rule: '#D9D2C0',
  /** Pressed secondary button or row. */
  pressedFill: '#EDE7D7',
} as const;

export type ColorToken = keyof typeof colors;
