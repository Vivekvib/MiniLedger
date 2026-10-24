/** Spacing scale (dp): 4, 8, 12, 16, 20, 24, 32, 48. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Corner radii: restrained, nothing pill-shaped or card-like. */
export const radius = {
  /** Buttons and inputs. */
  control: 6,
  /** Status chips. */
  chip: 2,
} as const;

export const layout = {
  /** Horizontal screen padding. */
  gutter: spacing.xl,
  /** Minimum touch target on either axis. */
  touchTarget: 48,
  /** Height of primary buttons and inputs. */
  controlHeight: 52,
  /** Hairline rules. */
  hairline: 1,
} as const;
