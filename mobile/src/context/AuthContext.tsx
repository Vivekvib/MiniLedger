import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getMe, logout } from '../services/api/endpoints';
import { isApiError } from '../services/api/errors';
import { session } from '../services/api/session';
import { clearToken, loadToken, saveToken } from '../services/auth/token-storage';
import type { AuthUser, LoginResult } from '../types/api';

/**
 * loading      reading the saved token and checking it with the server (splash screen is held)
 * unreachable  a token exists but the server could not be reached; the user can retry
 * signedOut    no valid session; only the (auth) screens are reachable
 * signedIn     valid session; only the (app) screens are reachable
 */
export type AuthStatus = 'loading' | 'unreachable' | 'signedOut' | 'signedIn';

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again.';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** A one-off message for the sign-in screen, such as "Your session expired." */
  notice: string | null;
  signIn: (result: LoginResult) => Promise<void>;
  /** User-initiated: revokes the session on the server (best effort), then clears local state. */
  signOut: () => Promise<void>;
  /** After `unreachable`: try validating the saved session again. */
  retryBootstrap: () => void;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);

  /** Forgets the session everywhere: memory, secure storage and every cached server response. */
  const endSession = useCallback(
    async (reason: string | null) => {
      session.setToken(null);
      setUser(null);
      setNotice(reason);
      setStatus('signedOut');
      queryClient.clear();
      await clearToken();
    },
    [queryClient],
  );

  // The API client calls this when the server rejects the token it just sent (401).
  useEffect(() => {
    session.setUnauthorizedHandler(() => {
      void endSession(SESSION_EXPIRED_MESSAGE);
    });
    return () => session.setUnauthorizedHandler(null);
  }, [endSession]);

  // Cold start: restore the saved token, then ask the server whether it is still good.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setStatus('loading');
      const token = await loadToken();
      if (cancelled) return;
      if (!token) {
        setStatus('signedOut');
        return;
      }

      session.setToken(token);
      try {
        const me = await getMe();
        if (cancelled) return;
        setUser(me);
        setStatus('signedIn');
      } catch (error) {
        if (cancelled) return;
        // A 401 has already ended the session through the unauthorized handler.
        if (isApiError(error) && error.status === 401) return;
        // Offline, timeout or a server problem: keep the token, let the user retry.
        setStatus('unreachable');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt]);

  const signIn = useCallback(async (result: LoginResult) => {
    session.setToken(result.token);
    // If secure storage fails the user stays signed in until the app closes; see token-storage.ts.
    await saveToken(result.token);
    setUser(result.user);
    setNotice(null);
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // Offline or already expired. The server session lapses on its own; local state still clears.
    }
    await endSession(null);
  }, [endSession]);

  const retryBootstrap = useCallback(() => setBootstrapAttempt((n) => n + 1), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, notice, signIn, signOut, retryBootstrap, clearNotice }),
    [status, user, notice, signIn, signOut, retryBootstrap, clearNotice],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
