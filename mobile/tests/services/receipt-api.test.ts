import { IMAGE_REQUEST_TIMEOUT_MS, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from '../../src/services/api/client';
import { RECEIPT_UPLOAD_TIMEOUT_MS, deleteReceipt, fetchReceiptImage, uploadReceipt } from '../../src/services/api/endpoints';
import { ApiError } from '../../src/services/api/errors';
import { session } from '../../src/services/api/session';
import { fail, installFakeApi, makeLoan, makeReceipt, ok } from '../helpers/fakeApi';
import { resetSession, signedInSession } from '../helpers/render';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => signedInSession('token-123'));
afterEach(() => {
  resetSession();
  jest.useRealTimers();
});

describe('uploadReceipt', () => {
  it('PUTs the photo as JSON with the Bearer token and returns the updated loan', async () => {
    const withReceipt = makeLoan({ receipt: makeReceipt({ contentType: 'image/png', sizeBytes: 300 }) });
    const api = installFakeApi({ [`PUT /api/loans/${ID}/receipt`]: () => ok(withReceipt) });

    const loan = await uploadReceipt(ID, { contentType: 'image/png', data: 'AAAA' });

    expect(loan.receipt).toEqual({ contentType: 'image/png', sizeBytes: 300, uploadedAt: '2026-10-21T10:00:00.000Z' });
    const [call] = api.callsTo(`PUT /api/loans/${ID}/receipt`);
    expect(call?.body).toEqual({ contentType: 'image/png', data: 'AAAA' });
    expect(call?.headers.Authorization).toBe('Bearer token-123');
    expect(call?.headers['Content-Type']).toBe('application/json');
  });

  it('allows a long upload: the timeout is 60 seconds, not the usual 15', () => {
    expect(RECEIPT_UPLOAD_TIMEOUT_MS).toBe(60_000);
  });

  it('surfaces the server field message when the photo is refused', async () => {
    installFakeApi({
      [`PUT /api/loans/${ID}/receipt`]: () =>
        fail(400, 'VALIDATION_ERROR', 'The request is invalid.', { fields: { data: 'The image is too large. The maximum size is 5 MB.' } }),
    });

    const error = await uploadReceipt(ID, { contentType: 'image/jpeg', data: 'AAAA' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).fieldErrors.data).toMatch(/too large/);
  });

  it('gives a clear error when the response is not a loan', async () => {
    installFakeApi({ [`PUT /api/loans/${ID}/receipt`]: () => ok({ nope: true }) });
    await expect(uploadReceipt(ID, { contentType: 'image/jpeg', data: 'AAAA' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('deleteReceipt', () => {
  it('sends DELETE with no body and returns the loan without a receipt', async () => {
    const api = installFakeApi({ [`DELETE /api/loans/${ID}/receipt`]: () => ok(makeLoan({ receipt: null })) });

    const loan = await deleteReceipt(ID);

    expect(loan.receipt).toBeNull();
    const [call] = api.callsTo(`DELETE /api/loans/${ID}/receipt`);
    expect(call?.body).toBeUndefined();
    expect(call?.headers['Content-Type']).toBeUndefined();
    expect(call?.headers.Authorization).toBe('Bearer token-123');
  });
});

describe('fetchReceiptImage', () => {
  const PATH = `GET /api/loans/${ID}/receipt`;
  const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);
  const loan = () => makeLoan({ receipt: makeReceipt({ contentType: 'image/jpeg', sizeBytes: photo.length }) });

  it('downloads the photo with fetch and the Bearer token and returns it as a data URL of the exact bytes', async () => {
    const api = installFakeApi({ [PATH]: () => ({ bytes: photo, contentType: 'image/jpeg' }) });

    const url = await fetchReceiptImage(loan());

    expect(url).toBe(`data:image/jpeg;base64,${photo.toString('base64')}`);
    const [call] = api.callsTo(PATH);
    expect(call?.headers.Authorization).toBe('Bearer token-123');
    expect(call?.headers.Accept).toBe('image/*');
  });

  it('labels the data URL with the loan\'s own image type, whatever the response header says', async () => {
    installFakeApi({ [PATH]: () => ({ bytes: photo, contentType: '' }) });
    const png = makeLoan({ receipt: makeReceipt({ contentType: 'image/png' }) });
    expect(await fetchReceiptImage(png)).toMatch(/^data:image\/png;base64,/);
  });

  it('turns a missing receipt into the server\'s message', async () => {
    installFakeApi({ [PATH]: () => fail(404, 'NOT_FOUND', 'Receipt not found.') });
    const error = await fetchReceiptImage(loan()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Receipt not found.' });
  });

  it('ends the session when the server refuses the current token, like every other request', async () => {
    const handler = jest.fn();
    session.setUnauthorizedHandler(handler);
    installFakeApi({ [PATH]: () => fail(401, 'UNAUTHORIZED', 'Authentication required. Please sign in again.') });

    await expect(fetchReceiptImage(loan())).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not end the session for a 401 that belongs to an older token', async () => {
    const handler = jest.fn();
    session.setUnauthorizedHandler(handler);
    installFakeApi({
      [PATH]: () => {
        session.setToken('a-newer-token'); // the user signed in again while this request was in flight
        return fail(401, 'UNAUTHORIZED', 'Authentication required. Please sign in again.');
      },
    });

    await expect(fetchReceiptImage(loan())).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports an unreachable server in plain words', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network request failed');
    }) as unknown as typeof fetch;
    await expect(fetchReceiptImage(loan())).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_MESSAGE });
  });

  it('gives up after 60 seconds', async () => {
    expect(IMAGE_REQUEST_TIMEOUT_MS).toBe(60_000);
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const pending = fetchReceiptImage(loan()).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(60_001);
    expect(await pending).toMatchObject({ status: 0, code: 'TIMEOUT', message: TIMEOUT_MESSAGE });
  });

  it('refuses an empty image instead of showing a blank box', async () => {
    installFakeApi({ [PATH]: () => ({ bytes: Buffer.alloc(0), contentType: 'image/jpeg' }) });
    await expect(fetchReceiptImage(loan())).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('does not call the server for a loan without a receipt', async () => {
    const api = installFakeApi();
    await expect(fetchReceiptImage(makeLoan({ receipt: null }))).rejects.toThrow('no receipt');
    expect(api.calls).toHaveLength(0);
  });

  it('sends no Authorization header when nobody is signed in', async () => {
    resetSession();
    const api = installFakeApi({ [PATH]: () => ({ bytes: photo, contentType: 'image/jpeg' }) });
    await fetchReceiptImage(loan());
    expect(api.callsTo(PATH)[0]?.headers.Authorization).toBeUndefined();
  });
});

describe('the loan schema', () => {
  it('accepts a loan from an older server that has no receipt field, as "no receipt"', async () => {
    const { receipt: _omit, ...legacy } = makeLoan();
    installFakeApi({ [`PUT /api/loans/${ID}/receipt`]: () => ok(legacy) });
    const loan = await uploadReceipt(ID, { contentType: 'image/jpeg', data: 'AAAA' });
    expect(loan.receipt).toBeNull();
  });

  it('rejects a receipt with an unsupported content type', async () => {
    installFakeApi({
      [`PUT /api/loans/${ID}/receipt`]: () => ok({ ...makeLoan(), receipt: { contentType: 'image/gif', sizeBytes: 1, uploadedAt: 'x' } }),
    });
    await expect(uploadReceipt(ID, { contentType: 'image/jpeg', data: 'AAAA' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
