import { Stack } from 'expo-router';
import { colors } from '../../theme';

// The sign-in flow always starts at the phone-number screen.
export const unstable_settings = { anchor: 'login' };

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
