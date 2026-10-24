import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import {
  createLoan,
  deleteReceipt,
  fetchReceiptImage,
  getMe,
  getSummary,
  listLoans,
  logout,
  repayLoan,
  requestOtp,
  uploadReceipt,
  verifyOtp,
} from '../../src/services/api/endpoints';
import { isApiError } from '../../src/services/api/errors';
import { session } from '../../src/services/api/session';
import { getApiBaseUrl } from '../../src/utils/config';
import { sleep } from '../helpers/sleep';
import { jpegBase64, textBase64 } from '../helpers/images';

/**
 * OPT-IN contract check: runs the mobile app's REAL API client and Zod schemas against a REAL
 * running backend. It is skipped in a normal `npm test`.
 *
 *   1. Start the backend and keep its terminal output in a file (the mock OTP is printed there):
 *        cd backend && npm run dev 2>&1 | tee /tmp/miniledger-server.log
 *   2. In another terminal:
 *        cd mobile
 *        MINILEDGER_LIVE_API=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 \
 *        MINILEDGER_SERVER_LOG=/tmp/miniledger-server.log npx jest tests/contract
 *
 * It creates one throwaway user (a random phone number) and one loan in the DEVELOPMENT database.
 */
const live = process.env.MINILEDGER_LIVE_API === '1';

/**
 * jest-expo replaces `fetch` with a native-backed implementation that cannot run under Node, so
 * this test supplies a minimal real one over node:http. The API client only uses `ok`, `status`,
 * `text()` and (for images) `blob()`, so that is all it provides. The blob carries the raw bytes
 * the way tests/setup.ts's FileReader expects.
 */
function nodeFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) {
  return new Promise<{ ok: boolean; status: number; text: () => Promise<string>; blob: () => Promise<unknown> }>((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => bytes.toString('utf8'),
          blob: async () => ({ __bytes: bytes, type: res.headers['content-type'] ?? '' }),
        });
      });
    });
    req.on('error', reject);
    init.signal?.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
/** Fetches a response body as raw bytes (the image route returns binary, not JSON). */
function nodeGetBytes(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; contentType: string | undefined; bytes: Buffer }>((resolve, reject) => {
    const req = request(url, { method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, contentType: res.headers['content-type'], bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}
const maybeDescribe = live ? describe : describe.skip;

/**
 * Reads the newest "[MiniLedger DEV OTP] +91••••••4170 -> 123456" line for the phone from the server
 * output. The server masks the number in its output, so the line is matched on the last four digits.
 */
function otpFromServerLog(phone: string): string {
  const path = process.env.MINILEDGER_SERVER_LOG;
  if (!path) throw new Error('Set MINILEDGER_SERVER_LOG to the file that holds the backend terminal output.');
  const lastFour = phone.slice(-4);
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.includes('DEV OTP') && line.includes(`${lastFour} ->`));
  const match = /-> (\d{6})/.exec(lines.at(-1) ?? '');
  if (!match?.[1]) throw new Error(`No one-time code for ${phone} found in ${path}.`);
  return match[1];
}

const randomPhone = () => `+9199${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

maybeDescribe('mobile API client against the live backend', () => {
  const phone = randomPhone();
  const dueDate = '2031-01-15'; // far in the future: never overdue
  let loanId = '';

  const originalFetch = global.fetch;
  beforeAll(() => {
    global.fetch = nodeFetch as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
    session.setToken(null);
  });

  it('requests a code and the response does not contain it', async () => {
    const result = await requestOtp(phone);
    expect(result).toEqual({ expiresInSeconds: expect.any(Number), resendAfterSeconds: expect.any(Number) });
    expect(JSON.stringify(result)).not.toMatch(/\d{6}/);
  });

  it('rejects a wrong code with the attempts left, then signs in with the right one', async () => {
    await sleep(300);
    const wrong = await verifyOtp(phone, '000000').catch((e: unknown) => e);
    expect(isApiError(wrong) && wrong.code).toBe('INVALID_OTP');
    expect(isApiError(wrong) && wrong.attemptsRemaining).toBe(4);

    const login = await verifyOtp(phone, otpFromServerLog(phone));
    expect(login.tokenType).toBe('Bearer');
    expect(login.user.phone).toBe(phone);
    session.setToken(login.token);

    expect(await getMe()).toEqual(login.user);
  });

  it('creates a loan; the same Idempotency-Key returns the same loan instead of a duplicate', async () => {
    const key = randomUUID();
    const first = await createLoan({ friendName: 'Contract Friend', amount: '1500.50', dueDate }, key);
    const second = await createLoan({ friendName: 'Contract Friend', amount: '1500.50', dueDate }, key);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ friendName: 'Contract Friend', amount: '1500.50', dueDate, status: 'outstanding', repaidAt: null });
    loanId = first.id;

    const { length } = await listLoans();
    expect(length).toBe(1);
  });

  it('serves a summary whose totals match the loan, as decimal strings', async () => {
    expect(await getSummary()).toMatchObject({
      totalLent: '1500.50',
      totalRepaid: '0.00',
      overdueAmount: '0.00',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
    });
  });

  it('repays once, and a second repayment is a 409 that changes nothing', async () => {
    const repaid = await repayLoan(loanId);
    expect(repaid.status).toBe('repaid');
    expect(repaid.repaidAt).not.toBeNull();

    const again = await repayLoan(loanId).catch((e: unknown) => e);
    expect(isApiError(again) && [again.status, again.code]).toEqual([409, 'ALREADY_REPAID']);

    expect(await getSummary()).toMatchObject({ totalLent: '1500.50', totalRepaid: '1500.50', overdueAmount: '0.00' });
  });

  it('stores a receipt photo, lists its details, serves back the exact bytes, and removes it', async () => {
    const photo = Buffer.from(jpegBase64(2048), 'base64');
    const withReceipt = await uploadReceipt(loanId, { contentType: 'image/jpeg', data: photo.toString('base64') });
    expect(withReceipt.receipt).toMatchObject({ contentType: 'image/jpeg', sizeBytes: 2048 });

    const listed = (await listLoans()).find((loan) => loan.id === loanId);
    expect(listed?.receipt).toEqual(withReceipt.receipt);

    // The app's own download path (fetch + Bearer token + blob -> data URL): the bytes must come back exactly.
    const dataUrl = await fetchReceiptImage(withReceipt);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64').equals(photo)).toBe(true);

    // Without the token the image is not served; with it, the raw route returns the same bytes.
    const address = `${getApiBaseUrl()}/api/loans/${loanId}/receipt`;
    expect((await nodeGetBytes(address, {})).status).toBe(401);
    const served = await nodeGetBytes(address, { Authorization: `Bearer ${session.getToken()}` });
    expect(served.status).toBe(200);
    expect(served.contentType).toBe('image/jpeg');
    expect(served.bytes.equals(photo)).toBe(true);

    const removed = await deleteReceipt(loanId);
    expect(removed.receipt).toBeNull();
    expect((await nodeGetBytes(address, { Authorization: `Bearer ${session.getToken()}` })).status).toBe(404);
    await expect(fetchReceiptImage(withReceipt)).rejects.toMatchObject({ status: 404 });
    expect((await deleteReceipt(loanId)).receipt).toBeNull(); // removing again is safe
  });

  it('refuses a file that is not really an image, with the server message on the data field', async () => {
    const error = await uploadReceipt(loanId, { contentType: 'image/jpeg', data: textBase64() }).catch((e: unknown) => e);
    expect(isApiError(error) && [error.status, error.code]).toEqual([400, 'VALIDATION_ERROR']);
    expect(isApiError(error) && error.fieldErrors.data).toMatch(/not a valid JPEG image/);
  });

  it('logout revokes the session: the same token is refused afterwards', async () => {
    const token = session.getToken();
    await logout();
    session.setToken(token); // the app forgets it on logout; keep it to prove the SERVER refuses it
    const error = await getMe().catch((e: unknown) => e);
    expect(isApiError(error) && [error.status, error.code]).toEqual([401, 'UNAUTHORIZED']);
  });
});
