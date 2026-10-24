import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env';
import { withTransaction } from '../../database/transaction';
import type { Clock } from '../../utils/clock';
import { AppError, Errors } from '../../utils/errors';
import type { Logger } from '../../utils/logger';
import { maskPhone } from '../../utils/phone';
import * as repo from './auth.repository';
import { generateOtp, hashesMatch, hashOtp } from './otp';
import type { OtpSender } from './otp-sender';
import { signAccessToken } from './tokens';

export interface AuthServiceDeps {
  pool: Pool;
  config: AppConfig;
  clock: Clock;
  otpSender: OtpSender;
  logger: Logger;
}

export interface PublicUser {
  id: string;
  phone: string;
}

export interface LoginResult {
  token: string;
  tokenType: 'Bearer';
  expiresAt: string;
  user: PublicUser;
}

type VerifyOutcome =
  | { kind: 'no_active_code' }
  | { kind: 'locked' }
  | { kind: 'expired' }
  | { kind: 'wrong'; attemptsRemaining: number; nowLocked: boolean }
  | { kind: 'ok'; user: repo.UserRow; sessionId: string; expiresAt: Date };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function createAuthService(deps: AuthServiceDeps) {
  const { pool, config, clock, otpSender, logger } = deps;

  return {
    /**
     * Issues a new code. Responds identically for every valid phone number, so the endpoint
     * does not reveal which numbers already have accounts (the user row is only created when
     * a code is successfully verified).
     */
    async requestOtp(phone: string): Promise<{ expiresInSeconds: number; resendAfterSeconds: number }> {
      const now = clock.now();
      const otp = generateOtp();

      await withTransaction(pool, async (client) => {
        // Serialises concurrent requests for the same number so the cooldown and the hourly
        // cap cannot be raced past. Released automatically when the transaction ends.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [phone]);

        const state = await repo.getThrottleState(client, phone, new Date(now.getTime() - HOUR_MS));

        if (state.newestInWindow) {
          const elapsed = (now.getTime() - state.newestInWindow.getTime()) / 1000;
          if (elapsed < config.otpResendCooldownSeconds) {
            throw Errors.tooManyRequests(
              'OTP_RESEND_TOO_SOON',
              'A code was just sent. Please wait before requesting another.',
              config.otpResendCooldownSeconds - elapsed,
            );
          }
        }
        if (state.recentCount >= config.otpMaxRequestsPerHour && state.oldestInWindow) {
          const retry = (state.oldestInWindow.getTime() + HOUR_MS - now.getTime()) / 1000;
          throw Errors.tooManyRequests(
            'OTP_REQUEST_LIMIT',
            'Too many code requests for this number. Please try again later.',
            retry,
          );
        }

        await repo.deleteStaleOtps(client, phone, new Date(now.getTime() - DAY_MS));
        await repo.insertOtp(client, {
          phone,
          codeHash: hashOtp(config.otpHmacSecret, phone, otp),
          expiresAt: new Date(now.getTime() + config.otpTtlSeconds * 1000),
          createdAt: now,
        });
      });

      // Deliver only after the row is committed, so a code is never printed for a request
      // that rolled back. A newer request supersedes any earlier code for this phone.
      await otpSender.send(phone, otp, config.otpTtlSeconds);
      logger.info({ phone: maskPhone(phone) }, 'otp issued');

      return { expiresInSeconds: config.otpTtlSeconds, resendAfterSeconds: config.otpResendCooldownSeconds };
    },

    /**
     * Verifies a code and opens a session.
     *
     * A failed guess is counted and COMMITTED before the error is raised (the transaction
     * returns an outcome instead of throwing). After OTP_MAX_ATTEMPTS failures the code is
     * locked for good: a later request with the correct code is refused without even being
     * compared, and the user must request a new code.
     */
    async verifyOtp(phone: string, otp: string): Promise<LoginResult> {
      const now = clock.now();

      const outcome = await withTransaction(pool, async (client): Promise<VerifyOutcome> => {
        const row = await repo.lockLatestOtp(client, phone);
        if (!row || row.consumedAt) return { kind: 'no_active_code' };
        if (row.lockedAt || row.attempts >= config.otpMaxAttempts) return { kind: 'locked' };
        if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };

        if (!hashesMatch(row.codeHash, hashOtp(config.otpHmacSecret, phone, otp))) {
          const result = await repo.recordFailedAttempt(client, row.id, config.otpMaxAttempts, now);
          return {
            kind: 'wrong',
            attemptsRemaining: Math.max(0, config.otpMaxAttempts - result.attempts),
            nowLocked: result.locked,
          };
        }

        await repo.consumeOtp(client, row.id, now);
        const user = await repo.upsertUser(client, phone, now);
        const expiresAt = new Date(now.getTime() + config.jwtTtlSeconds * 1000);
        const sessionId = await repo.createSession(client, { userId: user.id, createdAt: now, expiresAt });
        return { kind: 'ok', user, sessionId, expiresAt };
      });

      switch (outcome.kind) {
        case 'ok': {
          const signed = signAccessToken({
            secret: config.jwtSecret,
            userId: outcome.user.id,
            sessionId: outcome.sessionId,
            issuedAt: now,
            ttlSeconds: config.jwtTtlSeconds,
          });
          logger.info({ phone: maskPhone(phone), userId: outcome.user.id }, 'login succeeded');
          return {
            token: signed.token,
            tokenType: 'Bearer',
            expiresAt: signed.expiresAt.toISOString(),
            user: { id: outcome.user.id, phone: outcome.user.phone },
          };
        }
        case 'wrong':
          throw new AppError(
            401,
            'INVALID_OTP',
            outcome.nowLocked
              ? 'Incorrect code. This code is now locked; request a new one.'
              : 'Incorrect code. Check the code and try again.',
            { attemptsRemaining: outcome.attemptsRemaining, locked: outcome.nowLocked },
          );
        case 'locked':
          throw new AppError(
            429,
            'OTP_ATTEMPTS_EXCEEDED',
            'Too many incorrect attempts. This code is locked; request a new one.',
          );
        case 'expired':
          throw new AppError(401, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
        case 'no_active_code':
          // Also covers a code that was already used: single-use codes look "gone".
          throw new AppError(401, 'INVALID_OTP', 'No valid code for this number. Request a new one.', {
            attemptsRemaining: 0,
            locked: false,
          });
      }
    },

    async logout(sessionId: string): Promise<void> {
      await repo.revokeSession(pool, sessionId, clock.now());
    },

    async getMe(userId: string): Promise<PublicUser> {
      const user = await repo.findUserById(pool, userId);
      if (!user) throw Errors.unauthorized();
      return { id: user.id, phone: user.phone };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
