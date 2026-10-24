import { z } from 'zod';

/**
 * The wire contract with the backend (docs/api.md). Each response is parsed with these schemas
 * at the API boundary, so a contract change fails loudly there instead of rendering `undefined`
 * somewhere in the UI. The TypeScript types are inferred from the same schemas.
 *
 * Amounts are decimal STRINGS ("1500.00"); dates are "YYYY-MM-DD" or ISO timestamps.
 */

export const userSchema = z.object({
  id: z.string(),
  phone: z.string(),
});
export type AuthUser = z.infer<typeof userSchema>;

export const requestOtpResultSchema = z.object({
  expiresInSeconds: z.number(),
  resendAfterSeconds: z.number(),
});
export type RequestOtpResult = z.infer<typeof requestOtpResultSchema>;

export const loginResultSchema = z.object({
  token: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresAt: z.string(),
  user: userSchema,
});
export type LoginResult = z.infer<typeof loginResultSchema>;

export const meResultSchema = z.object({ user: userSchema });

export const logoutResultSchema = z.object({ loggedOut: z.boolean() });

export const loanStatusSchema = z.enum(['outstanding', 'overdue', 'repaid']);
export type LoanStatus = z.infer<typeof loanStatusSchema>;

export const receiptContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type ReceiptContentType = z.infer<typeof receiptContentTypeSchema>;

/** Details of a loan's receipt photo. The image itself is fetched separately, never listed. */
export const receiptSchema = z.object({
  contentType: receiptContentTypeSchema,
  sizeBytes: z.number(),
  uploadedAt: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const loanSchema = z.object({
  id: z.string(),
  userId: z.string(),
  friendName: z.string(),
  amount: z.string(),
  dueDate: z.string(),
  createdAt: z.string(),
  repaidAt: z.string().nullable(),
  status: loanStatusSchema,
  daysOverdue: z.number(),
  receipt: receiptSchema.nullable().default(null),
});
export type Loan = z.infer<typeof loanSchema>;

export const loansResultSchema = z.object({ loans: z.array(loanSchema) });

export const summarySchema = z.object({
  totalLent: z.string(),
  totalRepaid: z.string(),
  overdueAmount: z.string(),
  currency: z.literal('INR'),
  asOf: z.string(),
  timezone: z.string(),
});
export type Summary = z.infer<typeof summarySchema>;

/** What `PUT /api/loans/:id/receipt` sends: the photo as plain base64 (no `data:` prefix). */
export interface ReceiptUpload {
  contentType: ReceiptContentType;
  data: string;
}

/** What the add-loan form sends. `amount` is already a validated decimal string. */
export interface NewLoanInput {
  friendName: string;
  amount: string;
  dueDate: string;
}
