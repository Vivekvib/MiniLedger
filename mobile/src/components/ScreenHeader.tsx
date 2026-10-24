import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, layout, MAX_FONT_SCALE, spacing, type } from '../theme';

interface ScreenHeaderProps {
  title: string;
  /** Shows a back arrow that calls this. */
  onBack?: () => void;
  /** Right-hand slot, e.g. a Sign out button. */
  right?: ReactNode;
}

/** A plain title bar (no native header), so fonts, spacing and the back target match the design. */
export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="back-button"
            hitSlop={4}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        <Text style={type.title} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {title}
        </Text>
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: layout.touchTarget + spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.sm,
  },
  left: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: spacing.sm },
  back: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    marginLeft: -spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.pressedFill },
});
