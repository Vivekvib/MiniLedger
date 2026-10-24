import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { FlashProvider } from '../../src/context/FlashContext';
import { session } from '../../src/services/api/session';
import { createQueryClient } from '../../src/services/query-client';

/** Shows the auth state as text, so tests can assert that signing in or out happened. */
export function AuthProbe() {
  const { status, user, notice } = useAuth();
  return (
    <View>
      <Text testID="auth-status">{status}</Text>
      <Text testID="auth-user">{user?.phone ?? ''}</Text>
      <Text testID="auth-notice">{notice ?? ''}</Text>
    </View>
  );
}

/**
 * A query client for tests: reads never retry, so failures show up immediately, and cached queries
 * and mutations are never garbage-collected on a timer (the default 5-minute timers would keep
 * Jest from exiting after the last test).
 */
export function newTestQueryClient() {
  const client = createQueryClient({ retryReads: false });
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    queries: { ...defaults.queries, gcTime: Infinity },
    mutations: { ...defaults.mutations, gcTime: Infinity },
  });
  return client;
}

/** Renders a screen inside the same providers the app uses (query client, flash, auth). */
export async function renderApp(ui: ReactElement, options: { queryClient?: QueryClient; probe?: boolean } = {}) {
  const queryClient = options.queryClient ?? newTestQueryClient();
  const result = await render(
    <QueryClientProvider client={queryClient}>
      <FlashProvider>
        <AuthProvider>
          {ui}
          {options.probe ? <AuthProbe /> : null}
        </AuthProvider>
      </FlashProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/** Puts a token in the in-memory session, as if the user had signed in. */
export function signedInSession(token = 'jwt-token-for-tests'): void {
  session.setToken(token);
}

export function resetSession(): void {
  session.setToken(null);
  session.setUnauthorizedHandler(null);
}
