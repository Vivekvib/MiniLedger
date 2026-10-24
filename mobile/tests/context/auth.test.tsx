import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { SESSION_EXPIRED_MESSAGE, useAuth } from '../../src/context/AuthContext';
import { getSummary } from '../../src/services/api/endpoints';
import { session } from '../../src/services/api/session';
import { fail, installFakeApi, LOGIN_RESULT, ok, USER, makeSummary } from '../helpers/fakeApi';
import { renderApp, resetSession } from '../helpers/render';

const TOKEN_KEY = 'miniledger.access_token';
const secureStore = () => jest.requireMock('expo-secure-store').__store as Map<string, string>;

/** Buttons that drive the context the way screens do. */
function Controls() {
  const { signIn, signOut, retryBootstrap } = useAuth();
  return (
    <>
      <Pressable testID="sign-in" onPress={() => void signIn(LOGIN_RESULT)}>
        <Text>sign in</Text>
      </Pressable>
      <Pressable testID="sign-out" onPress={() => void signOut()}>
        <Text>sign out</Text>
      </Pressable>
      <Pressable testID="retry" onPress={retryBootstrap}>
        <Text>retry</Text>
      </Pressable>
    </>
  );
}

const status = () => screen.getByTestId('auth-status').props.children as string;

afterEach(() => resetSession());

describe('AuthProvider: cold start', () => {
  it('is signed out, with no network call, when there is no saved token', async () => {
    const api = installFakeApi();
    await renderApp(<Controls />, { probe: true });

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(api.calls).toHaveLength(0);
    expect(session.getToken()).toBeNull();
  });

  it('restores a saved token that the server still accepts', async () => {
    secureStore().set(TOKEN_KEY, 'saved-token');
    const api = installFakeApi({ 'GET /api/auth/me': () => ok({ user: USER }) });
    await renderApp(<Controls />, { probe: true });

    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(screen.getByTestId('auth-user').props.children).toBe(USER.phone);
    expect(api.calls[0]?.headers.Authorization).toBe('Bearer saved-token');
  });

  it('ends the session, shows the expiry notice and deletes the token when the server says 401', async () => {
    secureStore().set(TOKEN_KEY, 'revoked-token');
    installFakeApi({ 'GET /api/auth/me': () => fail(401, 'UNAUTHORIZED', 'Authentication required.') });
    await renderApp(<Controls />, { probe: true });

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(screen.getByTestId('auth-notice').props.children).toBe(SESSION_EXPIRED_MESSAGE);
    expect(session.getToken()).toBeNull();
    await waitFor(() => expect(secureStore().has(TOKEN_KEY)).toBe(false));
  });

  it('treats an unreadable secure store as signed out instead of crashing', async () => {
    const store = jest.requireMock('expo-secure-store');
    store.getItemAsync.mockRejectedValueOnce(new Error('keystore corrupt'));
    installFakeApi();
    await renderApp(<Controls />, { probe: true });

    await waitFor(() => expect(status()).toBe('signedOut'));
  });

  it('keeps the token and reports "unreachable" when the server cannot be reached, then recovers on retry', async () => {
    secureStore().set(TOKEN_KEY, 'saved-token');
    let online = false;
    installFakeApi({
      'GET /api/auth/me': () => {
        if (!online) throw new TypeError('Network request failed');
        return ok({ user: USER });
      },
    });
    await renderApp(<Controls />, { probe: true });

    await waitFor(() => expect(status()).toBe('unreachable'));
    expect(secureStore().get(TOKEN_KEY)).toBe('saved-token'); // an outage must not sign the user out

    online = true;
    await fireEvent.press(screen.getByTestId('retry'));
    await waitFor(() => expect(status()).toBe('signedIn'));
  });

  it('also reports "unreachable" for a 5xx, without discarding the token', async () => {
    secureStore().set(TOKEN_KEY, 'saved-token');
    installFakeApi({ 'GET /api/auth/me': () => fail(503, 'SERVICE_UNAVAILABLE', 'Service unavailable.') });
    await renderApp(<Controls />, { probe: true });

    await waitFor(() => expect(status()).toBe('unreachable'));
    expect(secureStore().get(TOKEN_KEY)).toBe('saved-token');
  });
});

describe('AuthProvider: signing in and out', () => {
  it('signIn keeps the token in memory and in secure storage and exposes the user', async () => {
    installFakeApi();
    await renderApp(<Controls />, { probe: true });
    await waitFor(() => expect(status()).toBe('signedOut'));

    await fireEvent.press(screen.getByTestId('sign-in'));

    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(session.getToken()).toBe(LOGIN_RESULT.token);
    expect(secureStore().get(TOKEN_KEY)).toBe(LOGIN_RESULT.token);
    expect(screen.getByTestId('auth-user').props.children).toBe(USER.phone);
    expect(screen.getByTestId('auth-notice').props.children).toBe('');
  });

  it('signIn still works for this app run if secure storage refuses the write', async () => {
    jest.requireMock('expo-secure-store').setItemAsync.mockRejectedValueOnce(new Error('locked'));
    installFakeApi();
    await renderApp(<Controls />, { probe: true });
    await waitFor(() => expect(status()).toBe('signedOut'));

    await fireEvent.press(screen.getByTestId('sign-in'));

    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(session.getToken()).toBe(LOGIN_RESULT.token);
  });

  it('signOut revokes the session on the server, clears storage and the query cache', async () => {
    secureStore().set(TOKEN_KEY, 'saved-token');
    const api = installFakeApi({
      'GET /api/auth/me': () => ok({ user: USER }),
      'POST /api/auth/logout': () => ok({ loggedOut: true }),
    });
    const { queryClient } = await renderApp(<Controls />, { probe: true });
    await waitFor(() => expect(status()).toBe('signedIn'));
    queryClient.setQueryData(['loans'], [{ id: 'secret' }]);

    await fireEvent.press(screen.getByTestId('sign-out'));

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(api.callsTo('POST /api/auth/logout')).toHaveLength(1);
    expect(api.callsTo('POST /api/auth/logout')[0]?.headers.Authorization).toBe('Bearer saved-token');
    expect(session.getToken()).toBeNull();
    expect(secureStore().has(TOKEN_KEY)).toBe(false);
    expect(queryClient.getQueryData(['loans'])).toBeUndefined(); // the next user must not see this data
    expect(screen.getByTestId('auth-notice').props.children).toBe(''); // a deliberate sign-out is not an "expired" notice
  });

  it('signOut still signs out locally when the server cannot be reached', async () => {
    secureStore().set(TOKEN_KEY, 'saved-token');
    installFakeApi({
      'GET /api/auth/me': () => ok({ user: USER }),
      'POST /api/auth/logout': () => {
        throw new TypeError('Network request failed');
      },
    });
    await renderApp(<Controls />, { probe: true });
    await waitFor(() => expect(status()).toBe('signedIn'));

    await fireEvent.press(screen.getByTestId('sign-out'));

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(secureStore().has(TOKEN_KEY)).toBe(false);
  });
});

describe('AuthProvider: session expiry while the app is in use', () => {
  it('any protected request answered with 401 signs the user out with the expiry notice and clears the cache', async () => {
    secureStore().set(TOKEN_KEY, 'saved-token');
    let revoked = false;
    installFakeApi({
      'GET /api/auth/me': () => ok({ user: USER }),
      'GET /api/summary': () => (revoked ? fail(401, 'UNAUTHORIZED', 'Authentication required.') : ok(makeSummary())),
    });
    const { queryClient } = await renderApp(<Controls />, { probe: true });
    await waitFor(() => expect(status()).toBe('signedIn'));
    queryClient.setQueryData(['summary'], makeSummary({ totalLent: '999.00' }));

    revoked = true; // for example: signed out from another device, or the token ran out
    await act(async () => {
      await getSummary().catch(() => undefined);
    });

    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(screen.getByTestId('auth-notice').props.children).toBe(SESSION_EXPIRED_MESSAGE);
    expect(queryClient.getQueryData(['summary'])).toBeUndefined();
    expect(secureStore().has(TOKEN_KEY)).toBe(false);
  });
});

describe('useAuth', () => {
  it('fails loudly when used outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(render(<Controls />)).rejects.toThrow(/inside <AuthProvider>/);
    } finally {
      spy.mockRestore();
    }
  });
});
