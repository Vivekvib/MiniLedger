import type { LoanRecord, LoanStatus } from './loans.repository';

/** The loan shape returned by the API. Amounts are decimal strings, dates are ISO strings. */
export interface LoanDto {
  id: string;
  userId: string;
  friendName: string;
  /** Exact decimal string with two places, e.g. "1500.00". */
  amount: string;
  /** Calendar date, `YYYY-MM-DD`, with no time zone. */
  dueDate: string;
  createdAt: string;
  repaidAt: string | null;
  status: LoanStatus;
  /** Whole days past the due date for an overdue loan; 0 otherwise. */
  daysOverdue: number;
  /** Details of the attached receipt photo, or null. The image itself is fetched separately. */
  receipt: ReceiptDto | null;
}

export interface ReceiptDto {
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export function toLoanDto(row: LoanRecord): LoanDto {
  return {
    id: row.id,
    userId: row.user_id,
    friendName: row.friend_name,
    amount: row.amount,
    dueDate: row.due_date,
    createdAt: row.created_at.toISOString(),
    repaidAt: row.repaid_at ? row.repaid_at.toISOString() : null,
    status: row.status,
    daysOverdue: row.days_overdue,
    receipt:
      row.receipt_uploaded_at && row.receipt_content_type && row.receipt_size_bytes !== null
        ? {
            contentType: row.receipt_content_type,
            sizeBytes: row.receipt_size_bytes,
            uploadedAt: row.receipt_uploaded_at.toISOString(),
          }
        : null,
  };
}
