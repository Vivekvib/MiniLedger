import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, layout, MAX_FONT_SCALE, spacing, type } from '../theme';
import { Button } from './Button';

/** First load, with nothing to show yet. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLiveRegion="polite" testID="loading-state">
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={[type.secondary, styles.text]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
    </View>
  );
}

interface ErrorStateProps {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}

/** A request failed and there is nothing cached to fall back on: say what happened, offer a retry. */
export function ErrorState({ title, message, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <View style={styles.center} testID="error-state">
      <Text style={[type.heading, styles.title]} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {title}
      </Text>
      <Text style={[type.body, styles.text]} accessibilityLiveRegion="assertive" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {message}
      </Text>
      <View style={styles.button}>
        <Button label={retryLabel} onPress={onRetry} testID="retry-button" />
      </View>
    </View>
  );
}

/** The list is empty. Says what the screen is for and what to do next. */
export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.empty} testID="empty-state">
      <Text style={[type.heading, styles.title]} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {title}
      </Text>
      <Text style={[type.body, styles.text]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.huge,
    gap: spacing.md,
  },
  empty: { paddingHorizontal: layout.gutter, paddingVertical: spacing.xxxl, gap: spacing.sm },
  title: { textAlign: 'center' },
  text: { textAlign: 'center', color: colors.textSecondary },
  button: { alignSelf: 'stretch', marginTop: spacing.sm },
});
