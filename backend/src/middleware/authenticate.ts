import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/env';
import { isSessionActive } from '../modules/auth/auth.repository';
import { verifyAccessToken } from '../modules/auth/tokens';
import type { Clock } from '../utils/clock';
import { Errors } from '../utils/errors';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** Returns the authenticated context or throws 401. Handlers behind `authenticate` use this. */
export function requireAuth(req: { auth?: AuthContext }): AuthContext {
  if (!req.auth) throw Errors.unauthorized();
  return req.auth;
}

/**
 * Protects a route. Two checks, both on EVERY request:
 *  1. the JWT signature, algorithm and expiry are valid, and
 *  2. its session row still exists, belongs to that user, is unrevoked and unexpired.
 *
 * The second check is a database lookup with no cache, so logout (which revokes the session)
 * invalidates the token on the very next request. Every failure produces the same 401 so the
 * response never reveals whether a token was malformed, expired or revoked.
 */
export function createAuthenticate(deps: { config: AppConfig; pool: Pool; clock: Clock }): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization');
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match || !match[1]) {
      next(Errors.unauthorized());
      return;
    }

    const now = deps.clock.now();
    const claims = verifyAccessToken(deps.config.jwtSecret, match[1], now);
    if (!claims) {
      next(Errors.unauthorized());
      return;
    }

    const active = await isSessionActive(deps.pool, claims.sessionId, claims.userId, now);
    if (!active) {
      next(Errors.unauthorized());
      return;
    }

    req.auth = { userId: claims.userId, sessionId: claims.sessionId };
    next();
  };
}
