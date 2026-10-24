import jwt from 'jsonwebtoken';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

const ALGORITHM = 'HS256';

/**
 * Signs an HS256 access token. `sub` is the user id; `jti` is the session id, which the
 * authenticate middleware looks up on every request so logout takes effect immediately.
 * Timestamps come from the injected clock rather than the real one.
 */
export function signAccessToken(params: {
  secret: string;
  userId: string;
  sessionId: string;
  issuedAt: Date;
  ttlSeconds: number;
}): SignedToken {
  const iat = Math.floor(params.issuedAt.getTime() / 1000);
  const exp = iat + params.ttlSeconds;
  const token = jwt.sign({ sub: params.userId, jti: params.sessionId, iat, exp }, params.secret, {
    algorithm: ALGORITHM,
  });
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Returns the claims, or null for ANY problem (bad signature, wrong algorithm, expired,
 * malformed, missing claims). Callers must not distinguish the reasons to the client.
 * The algorithm is pinned so `alg: none` and key-confusion tokens are rejected.
 */
export function verifyAccessToken(secret: string, token: string, now: Date): AccessTokenClaims | null {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: [ALGORITHM],
      clockTimestamp: Math.floor(now.getTime() / 1000),
    });
    if (typeof decoded === 'string') return null;
    const { sub, jti } = decoded;
    if (typeof sub !== 'string' || typeof jti !== 'string') return null;
    return { userId: sub, sessionId: jti };
  } catch {
    return null;
  }
}
