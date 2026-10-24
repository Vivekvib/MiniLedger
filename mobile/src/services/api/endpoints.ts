import {
  loanSchema,
  loansResultSchema,
  loginResultSchema,
  logoutResultSchema,
  meResultSchema,
  requestOtpResultSchema,
  summarySchema,
  type AuthUser,
  type Loan,
  type LoginResult,
  type NewLoanInput,
  type ReceiptUpload,
  type RequestOtpResult,
  type Summary,
} from '../../types/api';
import { apiRequest, apiRequestImage } from './client';

/** A photo can be several megabytes, so uploading gets longer than an ordinary request. */
export const RECEIPT_UPLOAD_TIMEOUT_MS = 60_000;

/** One typed function per backend route. Screens and hooks call these, never `fetch`. */

export function requestOtp(phone: string): Promise<RequestOtpResult> {
  return apiRequest({ method: 'POST', path: '/api/auth/request-otp', body: { phone }, schema: requestOtpResultSchema, auth: false });
}

export function verifyOtp(phone: string, otp: string): Promise<LoginResult> {
  return apiRequest({ method: 'POST', path: '/api/auth/verify-otp', body: { phone, otp }, schema: loginResultSchema, auth: false });
}

export async function getMe(): Promise<AuthUser> {
  return (await apiRequest({ path: '/api/auth/me', schema: meResultSchema })).user;
}

export async function logout(): Promise<void> {
  await apiRequest({ method: 'POST', path: '/api/auth/logout', schema: logoutResultSchema, timeoutMs: 5_000 });
}

export async function listLoans(): Promise<Loan[]> {
  return (await apiRequest({ path: '/api/loans', schema: loansResultSchema })).loans;
}

/**
 * `idempotencyKey` makes the call safe to retry: if the first attempt reached the server but the
 * response was lost, sending the same key again returns the original loan instead of a duplicate.
 */
export function createLoan(input: NewLoanInput, idempotencyKey: string): Promise<Loan> {
  return apiRequest({
    method: 'POST',
    path: '/api/loans',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
    schema: loanSchema,
  });
}

export function repayLoan(id: string): Promise<Loan> {
  return apiRequest({ method: 'PATCH', path: `/api/loans/${encodeURIComponent(id)}/repay`, schema: loanSchema });
}

export function getSummary(): Promise<Summary> {
  return apiRequest({ path: '/api/summary', schema: summarySchema });
}

/** Adds a receipt photo to a loan, or replaces the one already there. Returns the updated loan. */
export function uploadReceipt(loanId: string, upload: ReceiptUpload): Promise<Loan> {
  return apiRequest({
    method: 'PUT',
    path: `/api/loans/${encodeURIComponent(loanId)}/receipt`,
    body: upload,
    schema: loanSchema,
    timeoutMs: RECEIPT_UPLOAD_TIMEOUT_MS,
  });
}

/** Removes a loan's receipt. Safe to repeat: removing a receipt that isn't there succeeds. */
export function deleteReceipt(loanId: string): Promise<Loan> {
  return apiRequest({ method: 'DELETE', path: `/api/loans/${encodeURIComponent(loanId)}/receipt`, schema: loanSchema });
}

/**
 * Downloads a loan's receipt photo (with the Bearer token, like every other call) and returns it as
 * a `data:` URL for <Image>. Rejects for a loan without a receipt.
 */
export function fetchReceiptImage(loan: Loan): Promise<string> {
  if (!loan.receipt) return Promise.reject(new Error('This loan has no receipt.'));
  return apiRequestImage(`/api/loans/${encodeURIComponent(loan.id)}/receipt`, loan.receipt.contentType);
}
