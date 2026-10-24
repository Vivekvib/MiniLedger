import { Stack } from 'expo-router';
import { colors } from '../../theme';

// The dashboard is the root of the signed-in area; Add loan is pushed on top of it.
export const unstable_settings = { anchor: 'index' };

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
