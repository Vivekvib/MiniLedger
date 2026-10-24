import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, layout, MAX_FONT_SCALE, spacing, type } from '../theme';

interface TextButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

/** A quiet underlined action (Sign out, Resend code). The hit area is at least 48 x 48dp. */
export function TextButton({ label, onPress, disabled = false, accessibilityLabel, testID }: TextButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.base, pressed && !disabled && styles.pressed]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[type.button, styles.label, { color: disabled ? colors.textSecondary : colors.accent }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: layout.touchTarget,
    minWidth: layout.touchTarget,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.pressedFill },
  label: { textDecorationLine: 'underline' },
});
