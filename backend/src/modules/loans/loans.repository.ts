import type { Queryable } from '../../database/pool';
import { loanColumns } from './loan-sql';

export type LoanStatus = 'outstanding' | 'overdue' | 'repaid';

export interface LoanRecord {
  id: string;
  user_id: string;
  friend_name: string;
  amount: string;
  due_date: string;
  created_at: Date;
  repaid_at: Date | null;
  receipt_content_type: string | null;
  receipt_size_bytes: number | null;
  receipt_uploaded_at: Date | null;
  status: LoanStatus;
  days_overdue: number;
}

export interface NewLoan {
  userId: string;
  friendName: string;
  amount: string;
  dueDate: string;
  createdAt: Date;
  idempotencyKey: string | null;
}

/**
 * Inserts a loan. Returns null only when `idempotencyKey` is set and that key already exists
 * for this user: the unique index makes the check-and-insert atomic, so two simultaneous
 * retries cannot both create a row.
 */
export async function insertLoan(db: Queryable, loan: NewLoan, today: string): Promise<LoanRecord | null> {
  const { rows } = await db.query<LoanRecord>(
    `INSERT INTO loans (user_id, friend_name, amount, due_date, created_at, idempotency_key)
     VALUES ($1, $2, $3::numeric(12,2), $4::date, $5, $6)
     ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING ${loanColumns('$7')}`,
    [loan.userId, loan.friendName, loan.amount, loan.dueDate, loan.createdAt, loan.idempotencyKey, today],
  );
  return rows[0] ?? null;
}

export async function findLoanByIdempotencyKey(
  db: Queryable,
  userId: string,
  key: string,
  today: string,
): Promise<LoanRecord | null> {
  const { rows } = await db.query<LoanRecord>(
    `SELECT ${loanColumns('$3')} FROM loans WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key, today],
  );
  return rows[0] ?? null;
}

/** Outstanding loans first (earliest due date first, so overdue ones lead), then repaid, newest first. */
export async function listLoans(db: Queryable, userId: string, today: string): Promise<LoanRecord[]> {
  const { rows } = await db.query<LoanRecord>(
    `SELECT ${loanColumns('$2')}
       FROM loans
      WHERE user_id = $1
      ORDER BY (repaid_at IS NOT NULL),
               CASE WHEN repaid_at IS NULL THEN due_date END ASC,
               repaid_at DESC,
               created_at DESC,
               id`,
    [userId, today],
  );
  return rows;
}

export async function findLoanForUser(
  db: Queryable,
  id: string,
  userId: string,
  today: string,
): Promise<LoanRecord | null> {
  const { rows } = await db.query<LoanRecord>(
    `SELECT ${loanColumns('$3')} FROM loans WHERE id = $1 AND user_id = $2`,
    [id, userId, today],
  );
  return rows[0] ?? null;
}

/**
 * Marks a loan repaid in ONE statement. The `repaid_at IS NULL` condition inside the UPDATE is
 * what makes repayment atomic: if two requests race, PostgreSQL lets exactly one match the row
 * and the other gets zero rows back, so repaid_at is written once and never overwritten.
 * Returns null when no outstanding loan with this id belongs to the user.
 */
export async function markRepaid(
  db: Queryable,
  id: string,
  userId: string,
  now: Date,
  today: string,
): Promise<LoanRecord | null> {
  const { rows } = await db.query<LoanRecord>(
    `UPDATE loans
        SET repaid_at = GREATEST($3::timestamptz, created_at)
      WHERE id = $1 AND user_id = $2 AND repaid_at IS NULL
  RETURNING ${loanColumns('$4')}`,
    [id, userId, now, today],
  );
  return rows[0] ?? null;
}

export interface StoredReceipt {
  bytes: Buffer;
  contentType: string;
  uploadedAt: Date;
}

/** Attaches (or replaces) the receipt. Returns null when the user has no loan with this id. */
export async function setReceipt(
  db: Queryable,
  id: string,
  userId: string,
  receipt: { bytes: Buffer; contentType: string; uploadedAt: Date },
  today: string,
): Promise<LoanRecord | null> {
  const { rows } = await db.query<LoanRecord>(
    `UPDATE loans
        SET receipt_data         = $3,
            receipt_content_type = $4,
            receipt_size_bytes   = $5,
            receipt_uploaded_at  = $6
      WHERE id = $1 AND user_id = $2
  RETURNING ${loanColumns('$7')}`,
    [id, userId, receipt.bytes, receipt.contentType, receipt.bytes.length, receipt.uploadedAt, today],
  );
  return rows[0] ?? null;
}

/** Removes the receipt, if any. Returns null only when the user has no loan with this id. */
export async function clearReceipt(db: Queryable, id: string, userId: string, today: string): Promise<LoanRecord | null> {
  const { rows } = await db.query<LoanRecord>(
    `UPDATE loans
        SET receipt_data = NULL, receipt_content_type = NULL,
            receipt_size_bytes = NULL, receipt_uploaded_at = NULL
      WHERE id = $1 AND user_id = $2
  RETURNING ${loanColumns('$3')}`,
    [id, userId, today],
  );
  return rows[0] ?? null;
}

/** The stored image, or null when the loan is not this user's or has no receipt. */
export async function findReceipt(db: Queryable, id: string, userId: string): Promise<StoredReceipt | null> {
  const { rows } = await db.query<{ receipt_data: Buffer; receipt_content_type: string; receipt_uploaded_at: Date }>(
    `SELECT receipt_data, receipt_content_type, receipt_uploaded_at
       FROM loans
      WHERE id = $1 AND user_id = $2 AND receipt_data IS NOT NULL`,
    [id, userId],
  );
  const row = rows[0];
  return row
    ? { bytes: row.receipt_data, contentType: row.receipt_content_type, uploadedAt: row.receipt_uploaded_at }
    : null;
}
