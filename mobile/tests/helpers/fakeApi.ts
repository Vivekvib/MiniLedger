import { getApiBaseUrl } from '../../src/utils/config';
import type { Loan, LoginResult, Receipt, Summary } from '../../src/types/api';

/**
 * A fake backend at the fetch boundary. The real API client, schemas and screens all run; only
 * the network is replaced, and every request is recorded so tests can assert on what was sent.
 */

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  /** A binary body (an image). The response then also offers `blob()`, as the real fetch does. */
  bytes?: Buffer;
  contentType?: string;
  /** Resolve this response only after the returned promise is released (to test in-flight states). */
  delayUntil?: Promise<void>;
}

export type Handler = (call: RecordedCall) => FakeResponse | Promise<FakeResponse>;

export interface FakeApi {
  calls: RecordedCall[];
  /** Calls whose method and path match, e.g. callsTo('POST /api/loans'). */
  callsTo: (route: string) => RecordedCall[];
  /** Adds or replaces the handler for a route such as 'GET /api/summary'. */
  on: (route: string, handler: Handler) => void;
}

export const ok = (data: unknown, status = 200): FakeResponse => ({ status, body: { data } });

export const fail = (status: number, code: string, message: string, details?: Record<string, unknown>): FakeResponse => ({
  status,
  body: { error: { code, message, ...(details ? { details } : {}) } },
});

export function installFakeApi(initial: Record<string, Handler> = {}): FakeApi {
  const handlers = new Map<string, Handler>(Object.entries(initial));
  const calls: RecordedCall[] = [];

  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.startsWith(getApiBaseUrl()) ? url.slice(getApiBaseUrl().length) : url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const call: RecordedCall = {
      method,
      path,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const handler = handlers.get(`${method} ${path}`);
    if (!handler) throw new Error(`FakeApi: no handler for ${method} ${path}`);
    const result = await handler(call);
    if (result.delayUntil) await result.delayUntil;

    const status = result.status ?? 200;
    const text = result.body === undefined ? '' : JSON.stringify(result.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      blob: async () => ({ __bytes: result.bytes ?? Buffer.alloc(0), type: result.contentType ?? '' }),
    } as unknown as Response;
  }) as typeof fetch;

  return {
    calls,
    callsTo: (route) => calls.filter((c) => `${c.method} ${c.path}` === route),
    on: (route, handler) => {
      handlers.set(route, handler);
    },
  };
}

/** Returns a promise and the function that resolves it, for holding a response open. */
export function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '99999999-9999-4999-8999-999999999999',
    friendName: 'Example Friend',
    amount: '1500.00',
    dueDate: '2026-11-01',
    createdAt: '2026-10-20T10:00:00.000Z',
    repaidAt: null,
    status: 'outstanding',
    daysOverdue: 0,
    receipt: null,
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    totalLent: '0.00',
    totalRepaid: '0.00',
    overdueAmount: '0.00',
    currency: 'INR',
    asOf: '2026-10-21',
    timezone: 'Asia/Kolkata',
    ...overrides,
  };
}

export const USER = { id: '99999999-9999-4999-8999-999999999999', phone: '+911234567890' };

export const LOGIN_RESULT: LoginResult = {
  token: 'jwt-token-for-tests',
  tokenType: 'Bearer',
  expiresAt: '2026-10-28T10:00:00.000Z',
  user: USER,
};

export function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return { contentType: 'image/jpeg', sizeBytes: 123_456, uploadedAt: '2026-10-21T10:00:00.000Z', ...overrides };
}
