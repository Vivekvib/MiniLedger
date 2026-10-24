/**
 * Shared mocks for native modules and the router. Everything else (the API client, the auth
 * context, the screens, TanStack Query) runs for real; only the platform edge is replaced.
 */
import '@testing-library/react-native';

// Safe-area insets: a ready-made mock ships with the library.
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);

// Secure storage: an in-memory map, reachable from tests through __store.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// Icon fonts load through expo-font and the native asset registry, neither of which exists in Jest.
// The icon becomes plain text carrying its name, so tests can still see which icon was drawn.
jest.mock('@expo/vector-icons', () => {
  const { Text } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  return {
    Ionicons: ({ name }: { name: string }) => createElement(Text, { testID: `icon-${name}` }, ''),
  };
});

// Android hands image bytes to the app as a Blob and the app reads it with FileReader.readAsDataURL.
// Jest has no real Blob, so the fake backend returns `{ __bytes, type }` and this reads that.
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: { __bytes?: Buffer; type?: string }): void {
    void Promise.resolve().then(() => {
      if (!blob.__bytes) {
        this.error = new Error('not a fake blob');
        this.onerror?.();
        return;
      }
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${blob.__bytes.toString('base64')}`;
      this.onloadend?.();
    });
  }
}
Object.defineProperty(globalThis, 'FileReader', { value: FakeFileReader, configurable: true, writable: true });

// Predictable, distinct UUIDs for Idempotency-Key assertions.
jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`),
  };
});

// The native date dialog cannot open in tests; tests call its onValueChange to "pick" a date.
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
}));

// The camera and gallery cannot open in tests. Tests choose what the picker "returns" (see
// beforeEach below for the defaults: camera allowed, and a cancelled pick).
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

// Expo Router: screens only need useRouter / useLocalSearchParams / Redirect here.
jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  const { createElement } = jest.requireActual('react');
  const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
  const params: Record<string, string | undefined> = {};
  return {
    __router: router,
    __params: params,
    useRouter: () => router,
    useLocalSearchParams: () => params,
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect' }, href),
  };
});

beforeEach(() => {
  const secureStore = jest.requireMock('expo-secure-store');
  secureStore.__store.clear();
  jest.clearAllMocks();

  const picker = jest.requireMock('expo-image-picker');
  picker.requestCameraPermissionsAsync.mockReset().mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  picker.launchCameraAsync.mockReset().mockResolvedValue({ canceled: true, assets: null });
  picker.launchImageLibraryAsync.mockReset().mockResolvedValue({ canceled: true, assets: null });
});
