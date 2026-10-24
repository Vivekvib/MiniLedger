import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, layout, MAX_FONT_SCALE, radius, spacing, type } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** primary: solid accent fill. secondary: accent outline, no fill. */
  variant?: 'primary' | 'secondary';
  /** Replaces the label with a spinner and ignores presses (a request is in flight). */
  loading?: boolean;
  disabled?: boolean;
  /** 48 tall instead of 52, for use inside list rows. Still meets the 48dp touch target. */
  compact?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  compact = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const inactive = disabled || loading;
  const primary = variant === 'primary';

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { height: compact ? layout.touchTarget : layout.controlHeight },
        primary ? styles.primary : styles.secondary,
        pressed && !inactive && (primary ? styles.primaryPressed : styles.secondaryPressed),
        disabled && !loading && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.accent} />
      ) : (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={[type.button, { color: primary ? colors.onAccent : colors.accent }]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    paddingHorizontal: spacing.xl,
    minWidth: layout.touchTarget,
  },
  primary: { backgroundColor: colors.accent },
  primaryPressed: { backgroundColor: colors.accentPressed },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.accent },
  secondaryPressed: { backgroundColor: colors.pressedFill },
  disabled: { opacity: 0.45 },
});
