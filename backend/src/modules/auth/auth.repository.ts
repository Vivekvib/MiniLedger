import type { Queryable } from '../../database/pool';

export interface OtpRow {
  id: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lockedAt: Date | null;
  consumedAt: Date | null;
}

export interface UserRow {
  id: string;
  phone: string;
  createdAt: Date;
}

export interface ThrottleState {
  recentCount: number;
  oldestInWindow: Date | null;
  newestInWindow: Date | null;
}

interface OtpDbRow {
  id: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  locked_at: Date | null;
  consumed_at: Date | null;
}

interface UserDbRow {
  id: string;
  phone: string;
  created_at: Date;
}

const mapOtp = (r: OtpDbRow): OtpRow => ({
  id: r.id,
  codeHash: r.code_hash,
  expiresAt: r.expires_at,
  attempts: r.attempts,
  lockedAt: r.locked_at,
  consumedAt: r.consumed_at,
});

const mapUser = (r: UserDbRow): UserRow => ({ id: r.id, phone: r.phone, createdAt: r.created_at });

export async function getThrottleState(db: Queryable, phone: string, since: Date): Promise<ThrottleState> {
  const { rows } = await db.query<{ recent_count: number; oldest: Date | null; newest: Date | null }>(
    `SELECT count(*)::int AS recent_count, min(created_at) AS oldest, max(created_at) AS newest
       FROM otp_codes
      WHERE phone = $1 AND created_at > $2`,
    [phone, since],
  );
  const row = rows[0];
  return {
    recentCount: row?.recent_count ?? 0,
    oldestInWindow: row?.oldest ?? null,
    newestInWindow: row?.newest ?? null,
  };
}

export async function deleteStaleOtps(db: Queryable, phone: string, olderThan: Date): Promise<void> {
  await db.query('DELETE FROM otp_codes WHERE phone = $1 AND created_at < $2', [phone, olderThan]);
}

export async function insertOtp(
  db: Queryable,
  params: { phone: string; codeHash: string; expiresAt: Date; createdAt: Date },
): Promise<void> {
  await db.query(
    'INSERT INTO otp_codes (phone, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)',
    [params.phone, params.codeHash, params.expiresAt, params.createdAt],
  );
}

/**
 * The newest code issued for this phone, locked FOR UPDATE until the transaction ends.
 * Two simultaneous verifications of the same code therefore run one after the other, and
 * the second sees `consumed_at` already set.
 */
export async function lockLatestOtp(db: Queryable, phone: string): Promise<OtpRow | null> {
  const { rows } = await db.query<OtpDbRow>(
    `SELECT id, code_hash, expires_at, attempts, locked_at, consumed_at
       FROM otp_codes
      WHERE phone = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
        FOR UPDATE`,
    [phone],
  );
  return rows[0] ? mapOtp(rows[0]) : null;
}

/** Counts a wrong guess and, on reaching the cap, permanently locks the code. */
export async function recordFailedAttempt(
  db: Queryable,
  id: string,
  maxAttempts: number,
  now: Date,
): Promise<{ attempts: number; locked: boolean }> {
  const { rows } = await db.query<{ attempts: number; locked_at: Date | null }>(
    `UPDATE otp_codes
        SET attempts  = attempts + 1,
            locked_at = CASE WHEN attempts + 1 >= $2 THEN COALESCE(locked_at, $3) ELSE locked_at END
      WHERE id = $1
  RETURNING attempts, locked_at`,
    [id, maxAttempts, now],
  );
  const row = rows[0];
  return { attempts: row?.attempts ?? maxAttempts, locked: row?.locked_at != null };
}

export async function consumeOtp(db: Queryable, id: string, now: Date): Promise<void> {
  await db.query('UPDATE otp_codes SET consumed_at = $2 WHERE id = $1', [id, now]);
}

/** Creates the user on first successful login; returns the existing one afterwards. */
export async function upsertUser(db: Queryable, phone: string, now: Date): Promise<UserRow> {
  const { rows } = await db.query<UserDbRow>(
    `INSERT INTO users (phone, created_at) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
     RETURNING id, phone, created_at`,
    [phone, now],
  );
  return mapUser(rows[0] as UserDbRow);
}

export async function findUserById(db: Queryable, id: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserDbRow>('SELECT id, phone, created_at FROM users WHERE id = $1', [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function createSession(
  db: Queryable,
  params: { userId: string; createdAt: Date; expiresAt: Date },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO sessions (user_id, created_at, expires_at) VALUES ($1, $2, $3) RETURNING id',
    [params.userId, params.createdAt, params.expiresAt],
  );
  return (rows[0] as { id: string }).id;
}

/** True only for a session that exists, belongs to the user, is unrevoked and unexpired. */
export async function isSessionActive(db: Queryable, sessionId: string, userId: string, now: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM sessions
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
    [sessionId, userId, now],
  );
  return (rowCount ?? 0) > 0;
}

export async function revokeSession(db: Queryable, sessionId: string, now: Date): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE id = $1', [sessionId, now]);
}
