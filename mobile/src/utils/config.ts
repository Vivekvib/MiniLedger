import { Platform } from 'react-native';

/**
 * Where the backend is, from the app's point of view.
 *
 * `EXPO_PUBLIC_API_URL` wins when set (see .env.example for the right value per device).
 * Otherwise: the Android emulator reaches the host computer at 10.0.2.2 (inside the emulator,
 * `localhost` is the emulator itself), and other platforms use localhost.
 *
 * Expo only inlines `process.env.EXPO_PUBLIC_*` when it is written exactly like this, so do not
 * refactor the access into a variable.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}
