import { StyleSheet, Text, View } from 'react-native';
import { colors, MAX_FONT_SCALE, radius, spacing, type } from '../theme';
import { TextButton } from './TextButton';

export type BannerTone = 'success' | 'error' | 'info';

interface BannerProps {
  message: string;
  tone: BannerTone;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  testID?: string;
}

/**
 * An inline message with a 4px coloured rule on the left. The message is always words, so the
 * tone never depends on colour alone. Errors are announced assertively, the rest politely.
 */
export function Banner({ message, tone, actionLabel, onAction, onDismiss, testID }: BannerProps) {
  const ruleColor = tone === 'error' ? colors.overdue : tone === 'success' ? colors.accent : colors.textSecondary;
  return (
    <View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      testID={testID}
      style={[styles.box, { borderLeftColor: ruleColor }]}
    >
      <Text style={[type.secondary, styles.message]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {message}
      </Text>
      {(actionLabel && onAction) || onDismiss ? (
        <View style={styles.actions}>
          {actionLabel && onAction ? <TextButton label={actionLabel} onPress={onAction} /> : null}
          {onDismiss ? <TextButton label="Dismiss" onPress={onDismiss} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.rule,
    borderLeftWidth: 4,
    borderRadius: radius.chip,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  message: { color: colors.text, paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginLeft: -spacing.sm },
});
