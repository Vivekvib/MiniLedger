import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { layout, spacing } from '../theme';
import { Screen } from './Screen';

interface FormScreenProps {
  children: ReactNode;
  /** Rendered above the scrolling form (e.g. a ScreenHeader with a back arrow). */
  header?: ReactNode;
}

/**
 * Shared shell for screens with input fields: safe-area padding, a scroll view, and keyboard
 * avoidance, so the focused field and the buttons below it stay reachable when the keyboard opens.
 * `keyboardShouldPersistTaps="handled"` lets a button be tapped while the keyboard is up
 * instead of the first tap only dismissing the keyboard.
 */
export function FormScreen({ children, header }: FormScreenProps) {
  return (
    <Screen>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
});
