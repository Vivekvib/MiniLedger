import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createLoan, deleteReceipt, fetchReceiptImage, getSummary, listLoans, repayLoan, uploadReceipt } from '../services/api/endpoints';
import { isApiError } from '../services/api/errors';
import type { Loan, NewLoanInput, ReceiptUpload } from '../types/api';

/**
 * Server data goes through TanStack Query: the list and the summary are fetched from the real
 * API and never computed on the phone. After any change both are refetched, so the three totals
 * and the loan list can never disagree.
 */
export const queryKeys = {
  loans: ['loans'] as const,
  summary: ['summary'] as const,
  receiptImage: (loanId: string, uploadedAt: string) => ['receipt-image', loanId, uploadedAt] as const,
};

export const useLoans = () => useQuery({ queryKey: queryKeys.loans, queryFn: listLoans });

export const useSummary = () => useQuery({ queryKey: queryKeys.summary, queryFn: getSummary });

/** Refetches both and waits, so the dashboard is already correct when the mutation resolves. */
function refreshAll(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.loans }),
    queryClient.invalidateQueries({ queryKey: queryKeys.summary }),
  ]);
}

export interface AddLoanVariables {
  input: NewLoanInput;
  idempotencyKey: string;
  /** An optional receipt photo, uploaded right after the loan is created. */
  receipt?: ReceiptUpload | null;
}

export interface AddLoanResult {
  loan: Loan;
  /**
   * Set when the loan WAS saved but its receipt could not be uploaded. The loan is real and stays;
   * the receipt can be added again from the dashboard. (Two requests cannot be one transaction.)
   */
  receiptError: Error | null;
}

export function useAddLoan() {
  const queryClient = useQueryClient();
  return useMutation<AddLoanResult, Error, AddLoanVariables>({
    mutationFn: async ({ input, idempotencyKey, receipt }) => {
      const created = await createLoan(input, idempotencyKey);
      if (!receipt) return { loan: created, receiptError: null };
      try {
        return { loan: await uploadReceipt(created.id, receipt), receiptError: null };
      } catch (error) {
        return { loan: created, receiptError: error instanceof Error ? error : new Error(String(error)) };
      }
    },
    onSuccess: () => refreshAll(queryClient),
  });
}

export interface UploadReceiptVariables {
  loanId: string;
  receipt: ReceiptUpload;
}

/** Receipts change only the loan list (never the totals), so only that is refetched. */
export function useUploadReceipt() {
  const queryClient = useQueryClient();
  return useMutation<Loan, Error, UploadReceiptVariables>({
    mutationFn: ({ loanId, receipt }) => uploadReceipt(loanId, receipt),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.loans }),
  });
}

export function useRemoveReceipt() {
  const queryClient = useQueryClient();
  return useMutation<Loan, Error, string>({
    mutationFn: (loanId) => deleteReceipt(loanId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.loans }),
  });
}

export function useRepayLoan() {
  const queryClient = useQueryClient();
  return useMutation<Loan, Error, string>({
    mutationFn: (loanId) => repayLoan(loanId),
    onSuccess: () => refreshAll(queryClient),
    // 409: it was already repaid (another device, or a double tap that got through). The truth is
    // on the server, so refetch and let the list show it.
    onError: (error) => (isApiError(error) && error.status === 409 ? refreshAll(queryClient) : undefined),
  });
}

/**
 * A loan's receipt photo as a `data:` URL. The key includes the upload time, so a replaced photo is
 * a different entry and the old one is never shown. The photo itself never changes for a given key,
 * so it is not refetched in the background.
 */
export function useReceiptImage(loan: Loan | undefined) {
  const receipt = loan?.receipt ?? null;
  return useQuery({
    queryKey: queryKeys.receiptImage(loan?.id ?? '', receipt?.uploadedAt ?? ''),
    queryFn: () => fetchReceiptImage(loan as Loan),
    enabled: loan !== undefined && receipt !== null,
    staleTime: Infinity,
  });
}
