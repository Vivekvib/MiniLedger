import type { Queryable } from '../../database/pool';
import { overduePredicate } from '../loans/loan-sql';

export interface SummaryTotals {
  totalLent: string;
  totalRepaid: string;
  overdueAmount: string;
}

/**
 * All three totals in one scan of the user's loans. SUM runs on NUMERIC, so there is no
 * floating-point arithmetic anywhere, and the casts pin a fixed two-decimal text form
 * ("0.00" when there are no rows). The overdue condition is the shared predicate from
 * loan-sql, the same one the loan list uses for its `overdue` status.
 */
export async function getTotals(db: Queryable, userId: string, today: string): Promise<SummaryTotals> {
  const { rows } = await db.query<{ total_lent: string; total_repaid: string; overdue_amount: string }>(
    `SELECT
       COALESCE(SUM(amount), 0)::numeric(18,2)::text                                              AS total_lent,
       COALESCE(SUM(amount) FILTER (WHERE repaid_at IS NOT NULL), 0)::numeric(18,2)::text         AS total_repaid,
       COALESCE(SUM(amount) FILTER (WHERE ${overduePredicate('$2')}), 0)::numeric(18,2)::text     AS overdue_amount
     FROM loans
     WHERE user_id = $1`,
    [userId, today],
  );
  const row = rows[0];
  return {
    totalLent: row?.total_lent ?? '0.00',
    totalRepaid: row?.total_repaid ?? '0.00',
    overdueAmount: row?.overdue_amount ?? '0.00',
  };
}
