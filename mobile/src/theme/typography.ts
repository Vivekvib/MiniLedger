import type { TextStyle } from 'react-native';
import { colors } from './colors';

/**
 * Font family names as registered by `useFonts` in the root layout. Each weight is its own
 * family on Android, so `fontWeight` is deliberately never set alongside these.
 * If a font fails to load, React Native falls back to the system font and the app still works.
 */
export const fonts = {
  heading: 'Newsreader_600SemiBold',
  body: 'Inter_400Regular',
  bodyStrong: 'Inter_600SemiBold',
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

/** The approved type scale: size / line height in dp. */
export const type = {
  display: { fontFamily: fonts.bodyStrong, fontSize: 36, lineHeight: 40, fontVariant: tabular, color: colors.text },
  figure: { fontFamily: fonts.bodyStrong, fontSize: 28, lineHeight: 34, fontVariant: tabular, color: colors.text },
  title: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 34, color: colors.text },
  heading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: colors.text },
  amount: { fontFamily: fonts.bodyStrong, fontSize: 16, lineHeight: 24, fontVariant: tabular, color: colors.text },
  secondary: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  label: {
    fontFamily: fonts.bodyStrong,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  button: { fontFamily: fonts.bodyStrong, fontSize: 16, lineHeight: 20, color: colors.text },
} satisfies Record<string, TextStyle>;

export type TypeToken = keyof typeof type;

/** Large system font sizes must not break layout-critical text (amounts, chips, buttons). */
export const MAX_FONT_SCALE = 1.3;
