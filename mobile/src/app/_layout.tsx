import { Inter_400Regular, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Newsreader_600SemiBold } from '@expo-google-fonts/newsreader';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ErrorState } from '../components/ScreenStates';
import { Screen } from '../components/Screen';
import { TextButton } from '../components/TextButton';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { FlashProvider } from '../context/FlashContext';
import { createQueryClient } from '../services/query-client';
import { colors } from '../theme';

// Keep the splash screen up until fonts are loaded and the saved session has been checked.
void SplashScreen.preventAutoHideAsync();

/**
 * Route protection lives here. Each group is only reachable in its own auth state:
 *   signedOut  -> (auth)   login, verify
 *   signedIn   -> (app)    dashboard, add-loan
 * When the state flips (sign-in, sign-out, session expiry), the router moves the user to the
 * other group by itself. The server still enforces access on every API call; this only decides
 * which screens the app shows.
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status, retryBootstrap, signOut } = useAuth();
  const ready = fontsReady && status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  if (status === 'unreachable') {
    return (
      <Screen>
        <StatusBar style="dark" />
        <ErrorState
          title="Can't reach the server"
          message="You're still signed in on this phone. Check your connection and that the backend is running, then try again."
          onRetry={retryBootstrap}
          retryLabel="Try again"
        />
        <TextButton label="Sign out instead" onPress={() => void signOut()} />
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={status === 'signedOut'} redirectTo="/">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedIn'} redirectTo="/login">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // If a font fails to load the app still starts, using the system font.
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Newsreader_600SemiBold });
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <FlashProvider>
        <AuthProvider>
          <RootNavigator fontsReady={fontsLoaded || fontError !== null} />
        </AuthProvider>
      </FlashProvider>
    </QueryClientProvider>
  );
}
