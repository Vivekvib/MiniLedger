import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '../theme';

interface ScreenProps {
  children: ReactNode;
  /** Which screen edges get safe-area padding (status bar, gesture bar, notch). */
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
}

/** The base of every screen: paper background and safe-area padding, so nothing sits under system bars. */
export function Screen({ children, edges = ['top', 'bottom', 'left', 'right'], style }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.root, style]}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
