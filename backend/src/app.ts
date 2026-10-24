import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import type { AppConfig } from './config/env';
import { createAuthenticate } from './middleware/authenticate';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { createRateLimiters } from './middleware/rate-limit';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createAuthService } from './modules/auth/auth.service';
import type { OtpSender } from './modules/auth/otp-sender';
import { createHealthRouter } from './modules/health/health.routes';
import { createLoansRouter } from './modules/loans/loans.routes';
import { createLoansService } from './modules/loans/loans.service';
import { createSummaryRouter } from './modules/summary/summary.routes';
import { createSummaryService } from './modules/summary/summary.service';
import type { Clock } from './utils/clock';
import type { Logger } from './utils/logger';

const RECEIPT_UPLOAD_PATH = /^\/api\/loans\/[^/]+\/receipt\/?$/;

/** True for PUT /api/loans/:id/receipt, the only route allowed a large request body. */
function isReceiptUpload(method: string, path: string): boolean {
  return method === 'PUT' && RECEIPT_UPLOAD_PATH.test(path);
}

export interface AppDeps {
  config: AppConfig;
  pool: Pool;
  clock: Clock;
  otpSender: OtpSender;
  logger: Logger;
}

/**
 * Builds the Express app from injected dependencies. Nothing here touches process.env or
 * opens its own connections, which is what lets the tests run the real app against a test
 * database with a fake clock and a capturing OTP sender.
 */
export function createApp(deps: AppDeps): Express {
  const { config, pool, clock, otpSender, logger } = deps;

  const app = express();
  app.disable('x-powered-by');

  const limiters = createRateLimiters(config.rateLimit);
  const authenticate = createAuthenticate({ config, pool, clock });

  app.use(helmet());
  app.use(
    cors({
      // Native apps send no Origin header, so this list only matters for browsers (Expo web).
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['Retry-After', 'Idempotent-Replayed'],
    }),
  );

  // Request log: method, path (no query string), status, duration. No headers, no bodies.
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(
        { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms) },
        'request',
      );
    });
    next();
  });

  app.use(limiters.global);

  // Request bodies are limited to 10 KB everywhere except the receipt upload, whose body is a
  // photo. That one route reads its own, larger body, and only after authentication succeeds.
  const smallJson = express.json({ limit: '10kb' });
  app.use((req, res, next) => (isReceiptUpload(req.method, req.path) ? next() : smallJson(req, res, next)));

  const authService = createAuthService({ pool, config, clock, otpSender, logger });
  const loansService = createLoansService({ pool, config, clock });
  const summaryService = createSummaryService({ pool, config, clock });

  app.use('/api/health', createHealthRouter({ pool, clock }));
  app.use('/api/auth', createAuthRouter({ service: authService, authenticate, limiters }));
  app.use('/api/loans', createLoansRouter({ service: loansService, authenticate }));
  app.use('/api/summary', createSummaryRouter({ service: summaryService, authenticate }));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
