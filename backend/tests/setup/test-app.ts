import type { Express } from 'express';
import pino from 'pino';
import type { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../../src/app';
import { DEFAULT_RATE_LIMIT, loadConfig, type AppConfig } from '../../src/config/env';
import { createPool } from '../../src/database/pool';
import type { OtpSender } from '../../src/modules/auth/otp-sender';
import type { Clock } from '../../src/utils/clock';
import type { Logger } from '../../src/utils/logger';
import { assertConnectedToTestDatabase } from './db-guard';
import { getTestDatabaseUrl } from './test-env';

/** A clock the test controls. */
export class FakeClock implements Clock {
  private current: Date;
  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }
  now(): Date {
    return new Date(this.current.getTime());
  }
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/** Records every code instead of printing it, so tests can read the OTP like a user would. */
export class CapturingOtpSender implements OtpSender {
  readonly sent: Array<{ phone: string; otp: string; expiresInSeconds: number }> = [];

  async send(phone: string, otp: string, expiresInSeconds: number): Promise<void> {
    this.sent.push({ phone, otp, expiresInSeconds });
  }

  lastCodeFor(phone: string): string {
    const entry = [...this.sent].reverse().find((s) => s.phone === phone);
    if (!entry) throw new Error(`No OTP was sent to ${phone}`);
    return entry.otp;
  }
}

export const TEST_JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
export const TEST_OTP_SECRET = 'test-otp-hmac-secret-fedcba9876543210fedcba9876543210';
export const DEFAULT_START = new Date('2026-10-21T10:00:00.000Z'); // 15:30 on 21 Oct in IST

export function buildTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig({
    NODE_ENV: 'test',
    TEST_DATABASE_URL: getTestDatabaseUrl(),
    JWT_SECRET: TEST_JWT_SECRET,
    OTP_HMAC_SECRET: TEST_OTP_SECRET,
    LOG_LEVEL: 'silent',
  });
  return {
    ...base,
    // Per-IP limits are off by default so ordinary tests cannot trip them; rate-limit.test.ts
    // turns them on explicitly.
    rateLimit: { ...DEFAULT_RATE_LIMIT, enabled: false },
    ...overrides,
  };
}

export interface TestContext {
  app: Express;
  pool: Pool;
  clock: FakeClock;
  sender: CapturingOtpSender;
  config: AppConfig;
  logger: Logger;
}

export const silentLogger: Logger = pino({ level: 'silent' });

/** Wipes the four tables. Refuses to run unless the live connection is on a `*_test` database. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await assertConnectedToTestDatabase(pool);
  await pool.query('TRUNCATE TABLE loans, sessions, otp_codes, users RESTART IDENTITY CASCADE');
}

export async function createTestContext(
  options: {
    config?: Partial<AppConfig>;
    start?: Date;
    logger?: Logger;
    /** Wrap the real pool, for failure-injection tests. */
    wrapPool?: (pool: Pool) => Pool;
  } = {},
): Promise<TestContext> {
  const config = buildTestConfig(options.config);
  const realPool = createPool(config.databaseUrl, silentLogger);
  await resetDatabase(realPool);

  const clock = new FakeClock(options.start ?? DEFAULT_START);
  const sender = new CapturingOtpSender();
  const logger = options.logger ?? silentLogger;
  const pool = options.wrapPool ? options.wrapPool(realPool) : realPool;
  const app = createApp({ config, pool, clock, otpSender: sender, logger });

  return { app, pool: realPool, clock, sender, config, logger };
}

export async function closeTestContext(ctx: TestContext): Promise<void> {
  await ctx.pool.end();
}

export interface LoggedInUser {
  token: string;
  userId: string;
  phone: string;
  auth: { Authorization: string };
}

/**
 * Runs the real request-otp -> verify-otp flow, reading the code from the capturing sender.
 *
 * Sessions last JWT_TTL_SECONDS (7 days) on the injected clock. A test that jumps the clock
 * further ahead than that must log in again AT the instant it jumps to (pass `at`); the old
 * session is then correctly expired and would answer 401.
 */
export async function loginAs(ctx: TestContext, phone: string, at?: Date): Promise<LoggedInUser> {
  if (at) ctx.clock.set(at);
  await request(ctx.app).post('/api/auth/request-otp').send({ phone }).expect(200);
  const otp = ctx.sender.lastCodeFor(phone);
  const res = await request(ctx.app).post('/api/auth/verify-otp').send({ phone, otp }).expect(200);
  const { token, user } = res.body.data as { token: string; user: { id: string } };
  return { token, userId: user.id, phone, auth: { Authorization: `Bearer ${token}` } };
}

/** Creates a loan through the real API and returns it. */
export async function createLoan(
  ctx: TestContext,
  user: LoggedInUser,
  loan: { friendName?: string; amount: string | number; dueDate: string },
): Promise<{ id: string; [key: string]: unknown }> {
  const res = await request(ctx.app)
    .post('/api/loans')
    .set(user.auth)
    .send({ friendName: loan.friendName ?? 'Example Friend', amount: loan.amount, dueDate: loan.dueDate })
    .expect(201);
  return res.body.data as { id: string };
}

export const PHONE_A = '+911234567890';
export const PHONE_B = '+919876543210';
