import { apiRequest, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from '../../src/services/api/client';
import { createLoan, getSummary, listLoans, repayLoan, requestOtp, verifyOtp } from '../../src/services/api/endpoints';
import { ApiError, describeError } from '../../src/services/api/errors';
import { session } from '../../src/services/api/session';
import { z } from 'zod';
import { fail, installFakeApi, LOGIN_RESULT, makeLoan, makeSummary, ok } from '../helpers/fakeApi';
import { resetSession } from '../helpers/render';

afterEach(() => resetSession());

describe('apiRequest', () => {
  it('prefixes the Android emulator host, unwraps { data } and validates it', async () => {
    const api = installFakeApi({ 'GET /api/summary': () => ok(makeSummary({ totalLent: '1500.00' })) });
    const summary = await getSummary();
    expect(summary.totalLent).toBe('1500.00');
    expect(api.calls[0]).toMatchObject({ method: 'GET', path: '/api/summary' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://10.0.2.2:4000/api/summary');
  });

  it('attaches the Bearer token to protected calls', async () => {
    session.setToken('abc.def.ghi');
    const api = installFakeApi({ 'GET /api/loans': () => ok({ loans: [] }) });
    await listLoans();
    expect(api.calls[0]?.headers.Authorization).toBe('Bearer abc.def.ghi');
  });

  it('does NOT send the token on login calls', async () => {
    session.setToken('abc.def.ghi');
    const api = installFakeApi({
      'POST /api/auth/request-otp': () => ok({ expiresInSeconds: 300, resendAfterSeconds: 60 }),
      'POST /api/auth/verify-otp': () => ok(LOGIN_RESULT),
    });
    await requestOtp('+911234567890');
    await verifyOtp('+911234567890', '123456');
    expect(api.calls.every((c) => c.headers.Authorization === undefined)).toBe(true);
    expect(api.calls[1]?.body).toEqual({ phone: '+911234567890', otp: '123456' });
  });

  it('turns an error envelope into an ApiError with code, message and details', async () => {
    installFakeApi({
      'POST /api/loans': () => fail(400, 'VALIDATION_ERROR', 'Invalid request.', { fields: { amount: 'Amount must be greater than 0.' } }),
    });
    const error = await createLoan({ friendName: 'A', amount: '0', dueDate: '2026-11-01' }, 'key').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid request.' });
    expect(apiError.fieldErrors).toEqual({ amount: 'Amount must be greater than 0.' });
  });

  it('reports a network failure as ApiError status 0 with a friendly message', async () => {
    installFakeApi({
      'GET /api/summary': () => {
        throw new TypeError('Network request failed');
      },
    });
    const error = (await getSummary().catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_MESSAGE });
    expect(error.isNetwork).toBe(true);
  });

  it('times out a request that never answers', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ) as unknown as typeof fetch;

      const pending = apiRequest({ path: '/api/summary', schema: z.unknown(), timeoutMs: 1000 }).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(1001);
      expect(await pending).toMatchObject({ status: 0, code: 'TIMEOUT', message: TIMEOUT_MESSAGE });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a response that does not match the contract instead of passing junk to the UI', async () => {
    installFakeApi({ 'GET /api/summary': () => ok({ totalLent: 1500 }) });
    await expect(getSummary()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('survives a non-JSON error body (for example a proxy error page)', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' })) as unknown as typeof fetch;
    const error = (await getSummary().catch((e: unknown) => e)) as ApiError;
    expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
    expect(error.message).toMatch(/502/);
  });
});

describe('401 handling', () => {
  it('signs out when a request that carried the current token is rejected', async () => {
    session.setToken('current-token');
    const handler = jest.fn();
    session.setUnauthorizedHandler(handler);
    installFakeApi({ 'GET /api/summary': () => fail(401, 'UNAUTHORIZED', 'Authentication required.') });

    await expect(getSummary()).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not sign out on a 401 from a login call (wrong code is not an expired session)', async () => {
    session.setToken('current-token');
    const handler = jest.fn();
    session.setUnauthorizedHandler(handler);
    installFakeApi({ 'POST /api/auth/verify-otp': () => fail(401, 'INVALID_OTP', 'Incorrect code.', { attemptsRemaining: 4 }) });

    await expect(verifyOtp('+911234567890', '000000')).rejects.toMatchObject({ code: 'INVALID_OTP' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not sign out when there was no token to reject', async () => {
    const handler = jest.fn();
    session.setUnauthorizedHandler(handler);
    installFakeApi({ 'GET /api/summary': () => fail(401, 'UNAUTHORIZED', 'Authentication required.') });
    await expect(getSummary()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a late 401 for a token that has since been replaced by a new sign-in', async () => {
    session.setToken('old-token');
    const handler = jest.fn();
    session.setUnauthorizedHandler(handler);
    installFakeApi({
      'GET /api/summary': () => {
        session.setToken('new-token'); // the user signed in again while this request was in flight
        return fail(401, 'UNAUTHORIZED', 'Authentication required.');
      },
    });
    await expect(getSummary()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('endpoints', () => {
  it('createLoan sends the payload and the Idempotency-Key header', async () => {
    session.setToken('t');
    const loan = makeLoan();
    const api = installFakeApi({ 'POST /api/loans': () => ok(loan, 201) });
    const key = '00000000-0000-4000-8000-000000000001';
    const created = await createLoan({ friendName: 'Example Friend', amount: '1500.00', dueDate: '2026-11-01' }, key);
    expect(created.id).toBe(loan.id);
    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      body: { friendName: 'Example Friend', amount: '1500.00', dueDate: '2026-11-01' },
    });
    expect(api.calls[0]?.headers['Idempotency-Key']).toBe(key);
    expect(api.calls[0]?.headers['Content-Type']).toBe('application/json');
  });

  it('repayLoan PATCHes the loan path', async () => {
    session.setToken('t');
    const api = installFakeApi({ 'PATCH /api/loans/abc/repay': () => ok(makeLoan({ status: 'repaid' })) });
    await repayLoan('abc');
    expect(api.calls[0]).toMatchObject({ method: 'PATCH', path: '/api/loans/abc/repay' });
  });
});

describe('describeError', () => {
  it('adds the wait time to rate-limit messages', () => {
    const error = new ApiError(429, 'RATE_LIMITED', 'Too many requests.', { retryAfterSeconds: 42 });
    expect(describeError(error)).toBe('Too many requests. Try again in 42 seconds.');
    expect(describeError(new ApiError(429, 'OTP_REQUEST_LIMIT', 'Too many.', { retryAfterSeconds: 1800 }))).toMatch(/30 minutes/);
  });

  it('uses the server message for other API errors and a fallback for unknown errors', () => {
    expect(describeError(new ApiError(404, 'NOT_FOUND', 'Loan not found.'))).toBe('Loan not found.');
    expect(describeError(new Error('boom'), 'Fallback.')).toBe('Fallback.');
  });
});
