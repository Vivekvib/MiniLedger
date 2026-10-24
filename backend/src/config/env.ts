import { z } from 'zod';
import { assertValidTimeZone } from '../utils/app-date';

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  /** POST /auth/request-otp, per IP per window. */
  otpRequestMax: number;
  /** POST /auth/verify-otp, per IP per window. */
  otpVerifyMax: number;
  /** Every route, per IP per minute. */
  globalMax: number;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  logLevel: string;
  /** In test mode this is TEST_DATABASE_URL; DATABASE_URL is never read. */
  databaseUrl: string;
  jwtSecret: string;
  otpHmacSecret: string;
  jwtTtlSeconds: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpMaxRequestsPerHour: number;
  appTimezone: string;
  corsOrigins: string[];
  rateLimit: RateLimitConfig;
}

const secret = (name: string) =>
  z
    .string({ error: `${name} is required.` })
    .min(32, `${name} must be at least 32 characters. Generate one with the command in .env.example.`)
    .refine((v) => !v.startsWith('REPLACE_ME'), `${name} still holds the placeholder from .env.example.`);

const intWithDefault = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intWithDefault(4000, 1, 65535),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  TEST_DATABASE_URL: z.string().optional(),
  JWT_SECRET: secret('JWT_SECRET'),
  OTP_HMAC_SECRET: secret('OTP_HMAC_SECRET'),
  JWT_TTL_SECONDS: intWithDefault(604800, 60, 31536000),
  OTP_TTL_SECONDS: intWithDefault(300, 30, 3600),
  OTP_MAX_ATTEMPTS: intWithDefault(5, 1, 20),
  OTP_RESEND_COOLDOWN_SECONDS: intWithDefault(60, 0, 3600),
  OTP_MAX_REQUESTS_PER_HOUR: intWithDefault(5, 1, 100),
  APP_TIMEZONE: z.string().min(1).default('Asia/Kolkata'),
  CORS_ORIGINS: z.string().default(''),
});

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  enabled: true,
  windowMs: 15 * 60 * 1000,
  otpRequestMax: 10,
  otpVerifyMax: 30,
  globalMax: 300,
};

/**
 * Validates the environment once, at startup. Pure: it reads only the object it is given,
 * so tests can pass a synthetic environment.
 *
 * Safety rule: when NODE_ENV=test the database URL comes from TEST_DATABASE_URL only.
 * DATABASE_URL is not consulted, so `npm test` cannot connect to the development database
 * even if both variables are set.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const v = parsed.data;

  const databaseUrl = v.NODE_ENV === 'test' ? v.TEST_DATABASE_URL : v.DATABASE_URL;
  if (!databaseUrl) {
    const name = v.NODE_ENV === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
    throw new Error(`Invalid environment configuration:\n  - ${name}: is required when NODE_ENV=${v.NODE_ENV}.`);
  }

  if (v.JWT_SECRET === v.OTP_HMAC_SECRET) {
    throw new Error('Invalid environment configuration:\n  - JWT_SECRET and OTP_HMAC_SECRET must be different values.');
  }

  assertValidTimeZone(v.APP_TIMEZONE);

  return {
    env: v.NODE_ENV,
    port: v.PORT,
    host: v.HOST,
    logLevel: v.LOG_LEVEL,
    databaseUrl,
    jwtSecret: v.JWT_SECRET,
    otpHmacSecret: v.OTP_HMAC_SECRET,
    jwtTtlSeconds: v.JWT_TTL_SECONDS,
    otpTtlSeconds: v.OTP_TTL_SECONDS,
    otpMaxAttempts: v.OTP_MAX_ATTEMPTS,
    otpResendCooldownSeconds: v.OTP_RESEND_COOLDOWN_SECONDS,
    otpMaxRequestsPerHour: v.OTP_MAX_REQUESTS_PER_HOUR,
    appTimezone: v.APP_TIMEZONE,
    corsOrigins: v.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    rateLimit: { ...DEFAULT_RATE_LIMIT },
  };
}
