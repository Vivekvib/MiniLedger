/**
 * SQL fragments shared by the loan queries AND the summary query, so "overdue" has exactly one
 * definition in the codebase.
 *
 *   overdue  <=>  repaid_at IS NULL  AND  due_date < today
 *
 * `today` is a date-only value computed by the application clock in APP_TIMEZONE and bound as
 * a query parameter. A loan due today is not overdue until the application's day rolls over.
 * A repaid loan is never overdue, regardless of its due date.
 */

/** `todayParam` is a placeholder such as `$3`. */
export function overduePredicate(todayParam: string): string {
  return `(repaid_at IS NULL AND due_date < ${todayParam}::date)`;
}

/**
 * Columns returned for a loan, with the derived `status` and `days_overdue` computed in SQL
 * from the same predicate. `amount` is cast to text so the exact decimal reaches the API
 * untouched, and `due_date` is formatted explicitly so session DateStyle cannot change it.
 * Receipt details are included, but never `receipt_data` itself: the image bytes are read only
 * by the dedicated receipt query.
 */
export function loanColumns(todayParam: string): string {
  return `
    id,
    user_id,
    friend_name,
    amount::text AS amount,
    to_char(due_date, 'YYYY-MM-DD') AS due_date,
    created_at,
    repaid_at,
    receipt_content_type,
    receipt_size_bytes,
    receipt_uploaded_at,
    CASE
      WHEN repaid_at IS NOT NULL THEN 'repaid'
      WHEN ${overduePredicate(todayParam)} THEN 'overdue'
      ELSE 'outstanding'
    END AS status,
    CASE
      WHEN ${overduePredicate(todayParam)} THEN (${todayParam}::date - due_date)
      ELSE 0
    END AS days_overdue`;
}
