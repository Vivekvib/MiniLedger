import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { RateLimitConfig } from '../config/env';
import { AppError } from '../utils/errors';

export interface RateLimiters {
  global: RequestHandler;
  otpRequest: RequestHandler;
  otpVerify: RequestHandler;
}

const passthrough: RequestHandler = (_req, _res, next) => next();

function limiter(windowMs: number, limit: number, message: string): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // sets RateLimit-* and Retry-After
    legacyHeaders: false,
    handler: (_req, res, next) => {
      const header = Number(res.getHeader('Retry-After'));
      const retryAfterSeconds = Number.isFinite(header) && header > 0 ? header : Math.ceil(windowMs / 1000);
      next(
        new AppError(429, 'RATE_LIMITED', message, { retryAfterSeconds }, { 'Retry-After': String(retryAfterSeconds) }),
      );
    },
  });
}

/**
 * Per-IP limits, held in process memory (they reset on restart and are not shared between
 * instances). Per-phone OTP limits live in the database; see AuthService.requestOtp.
 */
export function createRateLimiters(config: RateLimitConfig): RateLimiters {
  if (!config.enabled) {
    return { global: passthrough, otpRequest: passthrough, otpVerify: passthrough };
  }
  const tooMany = 'Too many requests. Please wait a moment and try again.';
  return {
    global: limiter(60_000, config.globalMax, tooMany),
    otpRequest: limiter(config.windowMs, config.otpRequestMax, 'Too many code requests from this device. Please wait before trying again.'),
    otpVerify: limiter(config.windowMs, config.otpVerifyMax, 'Too many verification attempts from this device. Please wait before trying again.'),
  };
}
