import * as SecureStore from 'expo-secure-store';

/**
 * The access token lives in the platform's secure storage (Android Keystore-backed encrypted
 * storage, iOS Keychain), never in AsyncStorage or plain files. Keys may only contain letters,
 * digits, ".", "-" and "_".
 *
 * Storage can fail (corrupt keystore, restored backup, locked device), so every call is guarded:
 * a failed read means "signed out", and a failed write means the session lasts only until the app
 * is closed. Neither is allowed to crash the app.
 */
const TOKEN_KEY = 'miniledger.access_token';

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Returns false when the token could not be persisted (the caller keeps it in memory regardless). */
export async function saveToken(token: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Nothing useful to do: the in-memory token is cleared separately, and the next launch will
    // validate (and, if needed, reject) whatever is left.
  }
}
