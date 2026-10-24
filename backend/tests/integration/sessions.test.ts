import jwt from 'jsonwebtoken';
import request from 'supertest';
import {
  PHONE_A,
  PHONE_B,
  TEST_JWT_SECRET,
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

/** Every protected endpoint, so one failing guard cannot hide behind the others. */
const PROTECTED: Array<{ method: 'get' | 'post' | 'patch'; path: string }> = [
  { method: 'get', path: '/api/auth/me' },
  { method: 'post', path: '/api/auth/logout' },
  { method: 'get', path: '/api/loans' },
  { method: 'post', path: '/api/loans' },
  { method: 'patch', path: '/api/loans/3fa85f64-5717-4562-b3fc-2c963f66afa6/repay' },
  { method: 'get', path: '/api/summary' },
];

const call = (method: 'get' | 'post' | 'patch', path: string, headers: Record<string, string> = {}) =>
  request(ctx.app)[method](path).set(headers).send({ friendName: 'X', amount: 1, dueDate: '2026-11-01' });

describe('protected endpoints reject missing or invalid credentials', () => {
  it.each(PROTECTED)('$method $path without a token -> 401', async ({ method, path }) => {
    const res = await call(method, path).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each(PROTECTED)('$method $path with a garbage token -> 401', async ({ method, path }) => {
    await call(method, path, { Authorization: 'Bearer not.a.token' }).expect(401);
  });

  it('rejects non-Bearer schemes and malformed headers', async () => {
    const user = await loginAs(ctx, PHONE_A);
    for (const header of [`Basic ${user.token}`, user.token, 'Bearer', 'Bearer  ', `Bearer ${user.token} extra`]) {
      await request(ctx.app).get('/api/loans').set('Authorization', header).expect(401);
    }
  });

  it('rejects a token with a tampered signature', async () => {
    const user = await loginAs(ctx, PHONE_A);
    const tampered = `${user.token.slice(0, -4)}${user.token.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    await request(ctx.app).get('/api/loans').set('Authorization', `Bearer ${tampered}`).expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const user = await loginAs(ctx, PHONE_A);
    const claims = jwt.decode(user.token) as { sub: string; jti: string };
    const forged = jwt.sign({ sub: claims.sub, jti: claims.jti }, 'x'.repeat(48), { algorithm: 'HS256', expiresIn: 3600 });
    await request(ctx.app).get('/api/loans').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('rejects an alg:none token even when sub and jti match a live session', async () => {
    const user = await loginAs(ctx, PHONE_A);
    const claims = jwt.decode(user.token) as { sub: string; jti: string };
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: claims.sub, jti: claims.jti, exp: 9999999999 })).toString('base64url');
    await request(ctx.app).get('/api/loans').set('Authorization', `Bearer ${header}.${payload}.`).expect(401);
  });

  it('rejects a validly signed token whose session id does not exist', async () => {
    const user = await loginAs(ctx, PHONE_A);
    const forged = jwt.sign({ sub: user.userId, jti: '11111111-1111-4111-8111-111111111111' }, TEST_JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: 3600,
    });
    await request(ctx.app).get('/api/loans').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it("rejects a session id borrowed from another user's token", async () => {
    const a = await loginAs(ctx, PHONE_A);
    const b = await loginAs(ctx, PHONE_B);
    const sessionOfA = (jwt.decode(a.token) as { jti: string }).jti;
    const forged = jwt.sign({ sub: b.userId, jti: sessionOfA }, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: 3600 });
    await request(ctx.app).get('/api/loans').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('answers every kind of failure with the identical 401 body', async () => {
    const user = await loginAs(ctx, PHONE_A);
    await request(ctx.app).post('/api/auth/logout').set(user.auth).expect(200);

    const bodies = await Promise.all([
      request(ctx.app).get('/api/loans'),
      request(ctx.app).get('/api/loans').set('Authorization', 'Bearer garbage'),
      request(ctx.app).get('/api/loans').set(user.auth), // revoked
    ]);
    const unique = new Set(bodies.map((r) => JSON.stringify(r.body)));
    expect(unique.size).toBe(1);
  });
});

describe('token and session expiry', () => {
  it('rejects a token after its 7-day lifetime', async () => {
    const user = await loginAs(ctx, PHONE_A);
    ctx.clock.advanceSeconds(7 * 24 * 3600 - 1);
    await request(ctx.app).get('/api/auth/me').set(user.auth).expect(200);
    ctx.clock.advanceSeconds(1);
    await request(ctx.app).get('/api/auth/me').set(user.auth).expect(401);
  });

  it('rejects a still-valid JWT whose session row has expired in the database', async () => {
    const user = await loginAs(ctx, PHONE_A);
    await ctx.pool.query(
      `UPDATE sessions SET created_at = '2020-01-01T00:00:00Z', expires_at = '2020-01-02T00:00:00Z' WHERE user_id = $1`,
      [user.userId],
    );
    await request(ctx.app).get('/api/auth/me').set(user.auth).expect(401);
  });
});

describe('session revocation is checked on every protected request', () => {
  it('logout invalidates the token immediately, on every endpoint', async () => {
    const user = await loginAs(ctx, PHONE_A);
    const loan = await createLoan(ctx, user, { amount: 100, dueDate: '2026-11-01' });
    await request(ctx.app).get('/api/loans').set(user.auth).expect(200); // works before logout

    await request(ctx.app).post('/api/auth/logout').set(user.auth).expect(200);

    // The very same, still-unexpired JWT is now useless everywhere.
    await request(ctx.app).get('/api/auth/me').set(user.auth).expect(401);
    await request(ctx.app).get('/api/loans').set(user.auth).expect(401);
    await request(ctx.app).get('/api/summary').set(user.auth).expect(401);
    await request(ctx.app).post('/api/loans').set(user.auth).send({ friendName: 'X', amount: 1, dueDate: '2026-11-01' }).expect(401);
    await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(user.auth).expect(401);
    await request(ctx.app).post('/api/auth/logout').set(user.auth).expect(401);

    const [row] = (await ctx.pool.query('SELECT revoked_at FROM sessions')).rows as Array<{ revoked_at: Date | null }>;
    expect(row?.revoked_at?.toISOString()).toBe('2026-10-21T10:00:00.000Z');
  });

  it('revoking via the database (not the API) also takes effect on the next request', async () => {
    const user = await loginAs(ctx, PHONE_A);
    await request(ctx.app).get('/api/summary').set(user.auth).expect(200);
    await ctx.pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1', [user.userId]);
    await request(ctx.app).get('/api/summary').set(user.auth).expect(401);
  });

  it('logging out one session leaves the same user’s other sessions working', async () => {
    const first = await loginAs(ctx, PHONE_A);
    ctx.clock.advanceSeconds(120);
    const second = await loginAs(ctx, PHONE_A);

    await request(ctx.app).post('/api/auth/logout').set(first.auth).expect(200);
    await request(ctx.app).get('/api/auth/me').set(first.auth).expect(401);
    await request(ctx.app).get('/api/auth/me').set(second.auth).expect(200);
  });

  it('logging out does not delete the user’s data, and logging back in restores access', async () => {
    const user = await loginAs(ctx, PHONE_A);
    await createLoan(ctx, user, { amount: 250, dueDate: '2026-11-01' });
    await request(ctx.app).post('/api/auth/logout').set(user.auth).expect(200);

    ctx.clock.advanceSeconds(120);
    const again = await loginAs(ctx, PHONE_A);
    const res = await request(ctx.app).get('/api/loans').set(again.auth).expect(200);
    expect(res.body.data.loans).toHaveLength(1);
  });

  it('a token stops working once its user is deleted', async () => {
    const user = await loginAs(ctx, PHONE_A);
    await ctx.pool.query('DELETE FROM users WHERE id = $1', [user.userId]);
    await request(ctx.app).get('/api/auth/me').set(user.auth).expect(401);
  });
});
