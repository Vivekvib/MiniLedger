/**
 * The in-memory copy of the access token, readable synchronously by the API client.
 * AuthContext owns it: it persists the token to SecureStore and mirrors it here, and registers
 * the handler that runs when the server rejects the token.
 */
let currentToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export const session = {
  getToken: (): string | null => currentToken,
  setToken: (token: string | null): void => {
    currentToken = token;
  },
  /** Called when a request that carried the current token comes back 401. */
  setUnauthorizedHandler: (handler: (() => void) | null): void => {
    unauthorizedHandler = handler;
  },
  notifyUnauthorized: (): void => {
    unauthorizedHandler?.();
  },
};
