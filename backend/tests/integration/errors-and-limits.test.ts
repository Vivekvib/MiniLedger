import type { Pool } from 'pg';
import request from 'supertest';
import { DEFAULT_RATE_LIMIT } from '../../src/config/env';
import {
  PHONE_A,
  closeTestContext,
  createTestContext,
  loginAs,
  resetDatabase,
  type LoggedInUser,
  type TestContext,
} from '../setup/test-app';

/** A pool that can be switched into failure modes without touching the real database. */
function failurePool(real: Pool, mode: { fail: null | { code?: string; message: string } }): Pool {
  const maybeFail = () => {
    if (mode.fail) {
      throw Object.assign(new Error(mode.fail.message), { code: mode.fail.code });
    }
  };
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'query' || prop === 'connect') {
        return (...args: unknown[]) => {
          maybeFail();
          return (target[prop as 'query'] as (...a: unknown[]) => unknown)(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe('error handling', () => {
  const mode: { fail: null | { code?: string; message: string } } = { fail: null };
  let ctx: TestContext;
  let user: LoggedInUser;

  beforeAll(async () => {
    ctx = await createTestContext({ wrapPool: (real) => failurePool(real, mode) });
  });
  afterAll(() => closeTestContext(ctx));
  beforeEach(async () => {
    mode.fail = null;
    await resetDatabase(ctx.pool);
    ctx.sender.sent.length = 0;
    user = await loginAs(ctx, PHONE_A);
  });

  describe('health check', () => {
    it('reports ok with a real database round trip', async () => {
      const res = await request(ctx.app).get('/api/health').expect(200);
      expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
    });

    it('returns 503 in the standard envelope when the database is unreachable', async () => {
      mode.fail = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' };
      const res = await request(ctx.app).get('/api/health').expect(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('database failures', () => {
    it.each([
      ['connection refused', { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.1.2.3:5432' }],
      ['pool exhausted', { message: 'timeout exceeded when trying to connect' }],
      ['server shutting down', { code: '57P01', message: 'terminating connection due to administrator command' }],
      ['connection class 08', { code: '08006', message: 'connection failure' }],
    ])('returns 503 for %s on every protected route, without leaking internals', async (_label, failure) => {
      mode.fail = failure;
      const calls = [
        request(ctx.app).get('/api/loans').set(user.auth),
        request(ctx.app).get('/api/summary').set(user.auth),
        request(ctx.app).post('/api/loans').set(user.auth).send({ friendName: 'X', amount: 1, dueDate: '2026-11-01' }),
        request(ctx.app).post('/api/auth/request-otp').send({ phone: PHONE_A }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
        const body = JSON.stringify(res.body);
        expect(body).not.toContain(failure.message);
        expect(body).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|stack|postgres/i);
      }
    });

    it('returns 500 INTERNAL_ERROR for an unexpected failure, hiding the cause', async () => {
      mode.fail = { code: '22P02', message: 'invalid input syntax for type uuid: "SECRET-INTERNAL-DETAIL"' };
      const res = await request(ctx.app).get('/api/loans').set(user.auth).expect(500);
      expect(res.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
      });
      expect(JSON.stringify(res.body)).not.toContain('SECRET-INTERNAL-DETAIL');
    });

    it('recovers as soon as the database does', async () => {
      mode.fail = { code: 'ECONNREFUSED', message: 'down' };
      await request(ctx.app).get('/api/loans').set(user.auth).expect(503);
      mode.fail = null;
      await request(ctx.app).get('/api/loans').set(user.auth).expect(200);
    });
  });

  describe('malformed requests and unknown routes', () => {
    it('rejects invalid JSON with 400 INVALID_JSON', async () => {
      const res = await request(ctx.app)
        .post('/api/auth/request-otp')
        .set('Content-Type', 'application/json')
        .send('{not json')
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('rejects an oversized body with 413', async () => {
      const res = await request(ctx.app)
        .post('/api/loans')
        .set(user.auth)
        .send({ friendName: 'x'.repeat(20_000), amount: 1, dueDate: '2026-11-01' })
        .expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('returns a JSON 404 for unknown routes and unsupported methods', async () => {
      const unknown = await request(ctx.app).get('/api/nope').expect(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');
      await request(ctx.app).delete('/api/loans').set(user.auth).expect(404);
      await request(ctx.app).put('/api/summary').set(user.auth).expect(404);
    });

    it('does not advertise the framework', async () => {
      const res = await request(ctx.app).get('/api/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});

describe('per-IP rate limiting', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({
      config: {
        rateLimit: { ...DEFAULT_RATE_LIMIT, enabled: true, otpRequestMax: 3, otpVerifyMax: 4, globalMax: 1000 },
        otpResendCooldownSeconds: 0,
        otpMaxRequestsPerHour: 100,
      },
    });
  });
  afterAll(() => closeTestContext(ctx));

  it('limits OTP requests per IP and answers 429 with Retry-After', async () => {
    for (let i = 0; i < 3; i++) {
      await request(ctx.app).post('/api/auth/request-otp').send({ phone: `+91987654321${i}` }).expect(200);
    }
    const res = await request(ctx.app).post('/api/auth/request-otp').send({ phone: '+919876543219' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('limits OTP verification attempts per IP, independently of request-otp', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await request(ctx.app).post('/api/auth/verify-otp').send({ phone: PHONE_A, otp: '000000' });
      expect(res.status).toBe(401);
    }
    await request(ctx.app).post('/api/auth/verify-otp').send({ phone: PHONE_A, otp: '000000' }).expect(429);
  });

  it('leaves unrelated routes unaffected by the OTP limiters', async () => {
    await request(ctx.app).get('/api/health').expect(200);
  });
});

describe('global rate limit', () => {
  it('caps total requests per IP per minute', async () => {
    const ctx = await createTestContext({
      config: { rateLimit: { ...DEFAULT_RATE_LIMIT, enabled: true, globalMax: 5 } },
    });
    try {
      for (let i = 0; i < 5; i++) await request(ctx.app).get('/api/health').expect(200);
      const res = await request(ctx.app).get('/api/health').expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await closeTestContext(ctx);
    }
  });
});
