import type { z } from 'zod';
import { getApiBaseUrl } from '../../utils/config';
import { ApiError } from './errors';
import { session } from './session';

export const REQUEST_TIMEOUT_MS = 15_000;
/** Downloading a photo of up to 5 MB takes longer than an ordinary request. */
export const IMAGE_REQUEST_TIMEOUT_MS = 60_000;

export const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.';

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Parses and types `response.data`. */
  schema: z.ZodType<T>;
  /** Attach the Bearer token (default true). Login calls pass false. */
  auth?: boolean;
  timeoutMs?: number;
}

/**
 * The one place the app talks HTTP. It:
 *  - prefixes the configured base URL and attaches the Bearer token,
 *  - applies a timeout and turns network failures into ApiError(status 0),
 *  - unwraps the `{ data }` / `{ error }` envelope and validates `data` against the schema,
 *  - signs the user out when a request that carried the CURRENT token is answered 401.
 *    A 401 from a login call (no token sent) never signs anyone out, and a late 401 for a token
 *    that has since been replaced is ignored.
 */
export async function apiRequest<T>(options: RequestOptions<T>): Promise<T> {
  const { method = 'GET', path, body, headers = {}, schema, auth = true, timeoutMs = REQUEST_TIMEOUT_MS } = options;

  const sentToken = auth ? session.getToken() : null;
  const requestHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (sentToken) requestHeaders.Authorization = `Bearer ${sentToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let text: string;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', TIMEOUT_MESSAGE);
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE, { cause: String(error) });
  } finally {
    clearTimeout(timer);
  }

  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    const failure = toApiError(response.status, json);
    if (response.status === 401 && sentToken !== null && sentToken === session.getToken()) {
      session.notifyUnauthorized();
    }
    throw failure;
  }

  const envelope = (typeof json === 'object' && json !== null ? json : {}) as { data?: unknown };
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server sent an unexpected response. Please try again.');
  }
  return parsed.data;
}

function toApiError(status: number, json: unknown): ApiError {
  const error = (json as { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined)?.error;
  const code = typeof error?.code === 'string' ? error.code : 'HTTP_ERROR';
  const message =
    typeof error?.message === 'string' && error.message !== ''
      ? error.message
      : `The server returned an error (${status}). Please try again.`;
  const details =
    typeof error?.details === 'object' && error.details !== null ? (error.details as Record<string, unknown>) : undefined;
  return new ApiError(status, code, message, details);
}

/** Reads a Blob as a `data:` URL. React Native supports this (readAsDataURL) but not readAsArrayBuffer. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unreadable image data.')));
    reader.onerror = () => reject(reader.error ?? new Error('Unreadable image data.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads a protected image through the SAME path as every other request (`fetch`, Bearer token,
 * timeout, the same error handling and the same 401 rule) and returns it as a `data:` URL that
 * <Image> can show. Handing <Image> a plain address plus a header would make Android's separate
 * image loader do the networking, and that path could not be confirmed to work on a phone.
 *
 * `contentType` labels the data URL; the bytes themselves are never reinterpreted.
 */
export async function apiRequestImage(path: string, contentType: string, timeoutMs = IMAGE_REQUEST_TIMEOUT_MS): Promise<string> {
  const sentToken = session.getToken();
  const headers: Record<string, string> = { Accept: 'image/*' };
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let failureText = '';
  let dataUrl = '';
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { method: 'GET', headers, signal: controller.signal });
    if (response.ok) dataUrl = await blobToDataUrl(await response.blob());
    else failureText = await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(0, 'TIMEOUT', TIMEOUT_MESSAGE);
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE, { cause: String(error) });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let json: unknown;
    try {
      json = failureText === '' ? undefined : JSON.parse(failureText);
    } catch {
      json = undefined;
    }
    const failure = toApiError(response.status, json);
    if (response.status === 401 && sentToken !== null && sentToken === session.getToken()) session.notifyUnauthorized();
    throw failure;
  }

  const comma = dataUrl.indexOf(',');
  const base64 = comma === -1 ? '' : dataUrl.slice(comma + 1);
  if (base64 === '') throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server sent an empty image. Please try again.');
  return `data:${contentType};base64,${base64}`;
}
