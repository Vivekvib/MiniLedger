import jwt from 'jsonwebtoken';
import pino from 'pino';
import request from 'supertest';
import {
  PHONE_A,
  PHONE_B,
  closeTestContext,
  createLoan,
  createTestContext,
  loginAs,
  resetDatabase,
  type TestContext,
} from '../setup/test-app';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => closeTestContext(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.sender.sent.length = 0;
  ctx.clock.set(new Date('2026-10-21T10:00:00.000Z'));
});

const requestOtp = (phone: unknown) => request(ctx.app).post('/api/auth/request-otp').send({ phone });
const verifyOtp = (phone: unknown, otp: unknown) => request(ctx.app).post('/api/auth/verify-otp').send({ phone, otp });

async function dbRow<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await ctx.pool.query(sql, params);
  return rows as T[];
}

describe('POST /api/auth/request-otp', () => {
  it('accepts a valid phone number and reports expiry and resend timing', async () => {
    const res = await requestOtp(PHONE_A).expect(200);
    expect(res.body).toEqual({ data: { expiresInSeconds: 300, resendAfterSeconds: 60 } });
    expect(ctx.sender.sent).toHaveLength(1);
    expect(ctx.sender.sent[0]?.phone).toBe(PHONE_A);
  });

  it('never returns the OTP in the response body or headers', async () => {
    const res = await requestOtp(PHONE_A).expect(200);
    const otp = ctx.sender.lastCodeFor(PHONE_A);
    expect(JSON.stringify(res.body)).not.toContain(otp);
    expect(JSON.stringify(res.headers)).not.toContain(otp);
  });

  it('normalises formatting before use', async () => {
    await requestOtp('+91 12345-67890').expect(200);
    expect(ctx.sender.sent[0]?.phone).toBe('+911234567890');
  });

  it('stores only a keyed hash, never the code', async () => {
    await requestOtp(PHONE_A).expect(200);
    const otp = ctx.sender.lastCodeFor(PHONE_A);
    const rows = await dbRow<Record<string, unknown>>('SELECT * FROM otp_codes');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(otp);
  });

  it('sets the expiry five minutes ahead of the injected clock', async () => {
    await requestOtp(PHONE_A).expect(200);
    const [row] = await dbRow<{ expires_at: Date; created_at: Date }>('SELECT expires_at, created_at FROM otp_codes');
    expect(row?.created_at.toISOString()).toBe('2026-10-21T10:00:00.000Z');
    expect(row?.expires_at.toISOString()).toBe('2026-10-21T10:05:00.000Z');
  });

  it.each([[''], ['123'], ['abc'], ['9876543210'], ['+0123456789'], [12345], [null]])('rejects invalid phone %p', async (phone) => {
    const res = await requestOtp(phone).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.phone).toBeTruthy();
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it('rejects a missing phone field', async () => {
    const res = await request(ctx.app).post('/api/auth/request-otp').send({}).expect(400);
    expect(res.body.error.details.fields.phone).toMatch(/required|valid/i);
  });

  it('does not create a user at request time (no account enumeration)', async () => {
    await requestOtp(PHONE_A).expect(200);
    expect(await dbRow('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('enforces a resend cooldown with Retry-After', async () => {
    await requestOtp(PHONE_A).expect(200);
    ctx.clock.advanceSeconds(20);
    const res = await requestOtp(PHONE_A).expect(429);
    expect(res.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(res.body.error.details.retryAfterSeconds).toBe(40);
    expect(res.headers['retry-after']).toBe('40');
    expect(ctx.sender.sent).toHaveLength(1);

    ctx.clock.advanceSeconds(41);
    await requestOtp(PHONE_A).expect(200);
    expect(ctx.sender.sent).toHaveLength(2);
  });

  it('caps requests at five per hour per number, then recovers', async () => {
    for (let i = 0; i < 5; i++) {
      await requestOtp(PHONE_A).expect(200);
      ctx.clock.advanceSeconds(61);
    }
    const blocked = await requestOtp(PHONE_A).expect(429);
    expect(blocked.body.error.code).toBe('OTP_REQUEST_LIMIT');
    expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(ctx.sender.sent).toHaveLength(5);

    // The limit is per number, not global.
    await requestOtp(PHONE_B).expect(200);

    // After the oldest request leaves the one-hour window, requests work again.
    ctx.clock.advanceSeconds(3600);
    await requestOtp(PHONE_A).expect(200);
  });

  it('serialises simultaneous requests so the cooldown cannot be raced', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => requestOtp(PHONE_A)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429, 429, 429]);
    expect(ctx.sender.sent).toHaveLength(1);
  });
});

describe('POST /api/auth/verify-otp', () => {
  it('logs a NEW phone number in, creating the user, and returns a signed token', async () => {
    await requestOtp(PHONE_A).expect(200);
    const res = await verifyOtp(PHONE_A, ctx.sender.lastCodeFor(PHONE_A)).expect(200);

    const { token, tokenType, expiresAt, user } = res.body.data;
    expect(tokenType).toBe('Bearer');
    expect(user.phone).toBe(PHONE_A);
    expect(expiresAt).toBe('2026-10-28T10:00:00.000Z'); // 7 days
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe('HS256');

    const users = await dbRow<{ id: string; phone: string }>('SELECT id, phone FROM users');
    expect(users).toEqual([{ id: user.id, phone: PHONE_A }]);
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(1);
  });

  it('logs a RETURNING phone number in as the same user with a fresh session', async () => {
    const first = await loginAs(ctx, PHONE_A);
    ctx.clock.advanceSeconds(120);
    const second = await loginAs(ctx, PHONE_A);

    expect(second.userId).toBe(first.userId);
    expect(second.token).not.toBe(first.token);
    expect(await dbRow('SELECT 1 FROM users')).toHaveLength(1);
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(2);
  });

  it('issues a token the server then accepts on a protected route', async () => {
    const user = await loginAs(ctx, PHONE_A);
    const me = await request(ctx.app).get('/api/auth/me').set(user.auth).expect(200);
    expect(me.body.data.user).toEqual({ id: user.userId, phone: PHONE_A });
  });

  it('rejects an incorrect code and reports attempts remaining', async () => {
    await requestOtp(PHONE_A).expect(200);
    const res = await verifyOtp(PHONE_A, wrongCode(ctx.sender.lastCodeFor(PHONE_A))).expect(401);
    expect(res.body.error.code).toBe('INVALID_OTP');
    expect(res.body.error.details).toEqual({ attemptsRemaining: 4, locked: false });
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(0);
  });

  it('accepts a code one second before expiry and rejects it at expiry', async () => {
    await requestOtp(PHONE_A).expect(200);
    const otp = ctx.sender.lastCodeFor(PHONE_A);

    ctx.clock.advanceSeconds(300);
    const expired = await verifyOtp(PHONE_A, otp).expect(401);
    expect(expired.body.error.code).toBe('OTP_EXPIRED');
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(0);

    // A fresh code at the same moment works.
    await requestOtp(PHONE_A).expect(200);
    ctx.clock.advanceSeconds(299);
    await verifyOtp(PHONE_A, ctx.sender.lastCodeFor(PHONE_A)).expect(200);
  });

  it('does not count an expired attempt against the attempt limit', async () => {
    await requestOtp(PHONE_A).expect(200);
    ctx.clock.advanceSeconds(400);
    await verifyOtp(PHONE_A, wrongCode(ctx.sender.lastCodeFor(PHONE_A))).expect(401);
    const [row] = await dbRow<{ attempts: number }>('SELECT attempts FROM otp_codes');
    expect(row?.attempts).toBe(0);
  });

  it('rejects reuse of a code that already logged someone in (single use)', async () => {
    await requestOtp(PHONE_A).expect(200);
    const otp = ctx.sender.lastCodeFor(PHONE_A);
    await verifyOtp(PHONE_A, otp).expect(200);

    const reuse = await verifyOtp(PHONE_A, otp).expect(401);
    expect(reuse.body.error.code).toBe('INVALID_OTP');
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(1);
    const [row] = await dbRow<{ consumed_at: Date | null }>('SELECT consumed_at FROM otp_codes');
    expect(row?.consumed_at).not.toBeNull();
  });

  it('lets exactly one of two simultaneous correct submissions win', async () => {
    await requestOtp(PHONE_A).expect(200);
    const otp = ctx.sender.lastCodeFor(PHONE_A);
    const results = await Promise.all([verifyOtp(PHONE_A, otp), verifyOtp(PHONE_A, otp)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(1);
  });

  it('rejects verification when no code was ever requested', async () => {
    const res = await verifyOtp(PHONE_A, '123456').expect(401);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('only the newest code works: a new request supersedes the previous one', async () => {
    await requestOtp(PHONE_A).expect(200);
    const oldCode = ctx.sender.lastCodeFor(PHONE_A);
    ctx.clock.advanceSeconds(61);
    await requestOtp(PHONE_A).expect(200);
    const newCode = ctx.sender.lastCodeFor(PHONE_A);

    if (oldCode !== newCode) {
      await verifyOtp(PHONE_A, oldCode).expect(401);
    }
    await verifyOtp(PHONE_A, newCode).expect(200);
  });

  it('does not accept a code issued for a different phone number', async () => {
    await requestOtp(PHONE_A).expect(200);
    await requestOtp(PHONE_B).expect(200);
    const codeForA = ctx.sender.lastCodeFor(PHONE_A);
    const codeForB = ctx.sender.lastCodeFor(PHONE_B);
    if (codeForA !== codeForB) {
      await verifyOtp(PHONE_B, codeForA).expect(401);
    }
    await verifyOtp(PHONE_B, codeForB).expect(200);
  });

  it.each([['12345'], ['1234567'], ['abcdef'], ['12 456'], [''], [123456], [null]])(
    'rejects malformed code %p with 400 and does not burn an attempt',
    async (otp) => {
      await requestOtp(PHONE_A).expect(200);
      const res = await verifyOtp(PHONE_A, otp).expect(400);
      expect(res.body.error.details.fields.otp).toBeTruthy();
      const [row] = await dbRow<{ attempts: number }>('SELECT attempts FROM otp_codes');
      expect(row?.attempts).toBe(0);
    },
  );

  it('rejects an invalid phone on verify', async () => {
    const res = await verifyOtp('nope', '123456').expect(400);
    expect(res.body.error.details.fields.phone).toBeTruthy();
  });
});

describe('OTP attempt limit: five failures lock the code permanently', () => {
  it('counts attempts down, locks on the fifth failure, then refuses even the CORRECT code', async () => {
    await requestOtp(PHONE_A).expect(200);
    const correct = ctx.sender.lastCodeFor(PHONE_A);
    const wrong = wrongCode(correct);

    for (const remaining of [4, 3, 2, 1]) {
      const res = await verifyOtp(PHONE_A, wrong).expect(401);
      expect(res.body.error.code).toBe('INVALID_OTP');
      expect(res.body.error.details).toEqual({ attemptsRemaining: remaining, locked: false });
    }

    // Fifth wrong guess: still a 401, but it reports the lock.
    const fifth = await verifyOtp(PHONE_A, wrong).expect(401);
    expect(fifth.body.error.details).toEqual({ attemptsRemaining: 0, locked: true });

    // Sixth attempt carries the CORRECT code and must still be refused.
    const sixth = await verifyOtp(PHONE_A, correct).expect(429);
    expect(sixth.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');

    // And again, much later but before expiry: the lock is permanent, not a cooldown.
    ctx.clock.advanceSeconds(200);
    await verifyOtp(PHONE_A, correct).expect(429);

    const [row] = await dbRow<{ attempts: number; locked_at: Date | null; consumed_at: Date | null }>(
      'SELECT attempts, locked_at, consumed_at FROM otp_codes',
    );
    expect(row?.attempts).toBe(5);
    expect(row?.locked_at).not.toBeNull();
    expect(row?.consumed_at).toBeNull();
    expect(await dbRow('SELECT 1 FROM sessions')).toHaveLength(0);
    expect(await dbRow('SELECT 1 FROM users')).toHaveLength(0);
  });

  it('persists failed attempts even though the request returns an error (no rollback)', async () => {
    await requestOtp(PHONE_A).expect(200);
    const wrong = wrongCode(ctx.sender.lastCodeFor(PHONE_A));
    await verifyOtp(PHONE_A, wrong).expect(401);
    await verifyOtp(PHONE_A, wrong).expect(401);
    const [row] = await dbRow<{ attempts: number }>('SELECT attempts FROM otp_codes');
    expect(row?.attempts).toBe(2);
  });

  it('is recoverable only by requesting a NEW code, which works normally', async () => {
    await requestOtp(PHONE_A).expect(200);
    const locked = ctx.sender.lastCodeFor(PHONE_A);
    for (let i = 0; i < 5; i++) await verifyOtp(PHONE_A, wrongCode(locked)).expect(401);
    await verifyOtp(PHONE_A, locked).expect(429);

    ctx.clock.advanceSeconds(61);
    await requestOtp(PHONE_A).expect(200);
    const fresh = ctx.sender.lastCodeFor(PHONE_A);

    if (fresh !== locked) {
      // The locked code stays dead even after a replacement exists.
      await verifyOtp(PHONE_A, locked).expect(401);
    }
    await verifyOtp(PHONE_A, fresh).expect(200);
  });

  it('keeps simultaneous wrong guesses from exceeding the cap', async () => {
    await requestOtp(PHONE_A).expect(200);
    const correct = ctx.sender.lastCodeFor(PHONE_A);
    const wrong = wrongCode(correct);

    const results = await Promise.all(Array.from({ length: 10 }, () => verifyOtp(PHONE_A, wrong)));
    const counts = results.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    expect(counts[401]).toBe(5);
    expect(counts[429]).toBe(5);

    await verifyOtp(PHONE_A, correct).expect(429);
    const [row] = await dbRow<{ attempts: number }>('SELECT attempts FROM otp_codes');
    expect(row?.attempts).toBe(5);
  });
});

describe('logging hygiene', () => {
  it('never writes the OTP, the token or the full phone number to the application log', async () => {
    const lines: string[] = [];
    const capturingLogger = pino({ level: 'trace' }, { write: (line: string) => void lines.push(line) });
    const logged = await createTestContext({ logger: capturingLogger });
    try {
      const user = await loginAs(logged, PHONE_A);
      await createLoan(logged, user, { amount: 100, dueDate: '2026-11-01' });
      await request(logged.app).get('/api/loans').set(user.auth).expect(200);
      await request(logged.app).post('/api/auth/logout').set(user.auth).expect(200);

      const otp = logged.sender.sent[0]?.otp ?? '';
      const output = lines.join('\n');
      expect(output.length).toBeGreaterThan(0); // the logger really was exercised
      expect(output).not.toContain(otp);
      expect(output).not.toContain(user.token);
      expect(output).not.toContain('Bearer');
      expect(output).not.toContain(PHONE_A);
      expect(output).toContain('+91••••••7890');
    } finally {
      await closeTestContext(logged);
    }
  });
});

/** A six-digit code guaranteed to differ from `code`. */
function wrongCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}
