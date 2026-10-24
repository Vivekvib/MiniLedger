import type { Pool } from 'pg';
import type { AppConfig } from '../../config/env';
import { toAppDate } from '../../utils/app-date';
import type { Clock } from '../../utils/clock';
import { AppError, Errors } from '../../utils/errors';
import { toLoanDto, type LoanDto } from './loans.mapper';
import * as repo from './loans.repository';

export interface LoansServiceDeps {
  pool: Pool;
  config: AppConfig;
  clock: Clock;
}

export interface CreateLoanInput {
  friendName: string;
  amount: string;
  dueDate: string;
  /** Already validated and lower-cased by the controller, or null when the header is absent. */
  idempotencyKey: string | null;
}

export function createLoansService(deps: LoansServiceDeps) {
  const { pool, config, clock } = deps;

  /** "Today" for every overdue decision: the current instant seen in APP_TIMEZONE. */
  const today = (now: Date) => toAppDate(now, config.appTimezone);

  return {
    /**
     * Creates a loan. With an Idempotency-Key, retrying the same request returns the original
     * loan instead of creating a second one, which covers the case where the server committed
     * but the response never reached the client.
     *
     * Replaying a key with different loan details is rejected (422) rather than silently
     * returning an unrelated loan.
     */
    async createLoan(userId: string, input: CreateLoanInput): Promise<{ loan: LoanDto; replayed: boolean }> {
      const now = clock.now();
      const todayDate = today(now);

      const inserted = await repo.insertLoan(
        pool,
        {
          userId,
          friendName: input.friendName,
          amount: input.amount,
          dueDate: input.dueDate,
          createdAt: now,
          idempotencyKey: input.idempotencyKey,
        },
        todayDate,
      );
      if (inserted) return { loan: toLoanDto(inserted), replayed: false };

      // No row came back, so the key already exists for this user. Load the original.
      if (!input.idempotencyKey) {
        throw new Error('Loan insert returned no row without an idempotency key.');
      }
      const existing = await repo.findLoanByIdempotencyKey(pool, userId, input.idempotencyKey, todayDate);
      if (!existing) {
        // The row vanished between the conflict and the read. There is no delete endpoint, so
        // this indicates manual database changes; surface it as a retryable server error.
        throw new Error('Idempotency conflict row could not be loaded.');
      }

      const sameRequest =
        existing.friend_name === input.friendName &&
        existing.amount === input.amount &&
        existing.due_date === input.dueDate;
      if (!sameRequest) {
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different loan. Use a new key for a new loan.',
        );
      }
      return { loan: toLoanDto(existing), replayed: true };
    },

    async listLoans(userId: string): Promise<LoanDto[]> {
      const rows = await repo.listLoans(pool, userId, today(clock.now()));
      return rows.map(toLoanDto);
    },

    /**
     * Marks a loan repaid. The write is a single conditional UPDATE (see repo.markRepaid), so
     * concurrent or repeated requests produce exactly one success; the rest get 409.
     * A loan that does not exist and a loan owned by someone else both return 404, so the API
     * never confirms that another user's loan id exists.
     */
    async repayLoan(userId: string, loanId: string): Promise<LoanDto> {
      const now = clock.now();
      const todayDate = today(now);

      const updated = await repo.markRepaid(pool, loanId, userId, now, todayDate);
      if (updated) return toLoanDto(updated);

      const existing = await repo.findLoanForUser(pool, loanId, userId, todayDate);
      if (!existing) throw Errors.notFound('Loan not found.');

      throw new AppError(409, 'ALREADY_REPAID', 'This loan has already been marked as repaid.', {
        repaidAt: existing.repaid_at ? existing.repaid_at.toISOString() : null,
      });
    },

    /**
     * Attaches a receipt photo to one of the user's loans, replacing any earlier one. The image
     * has already been validated (size and real image signature) by the request schema. Allowed
     * for repaid loans too: a receipt can turn up after the money has come back.
     */
    async setReceipt(userId: string, loanId: string, receipt: { contentType: string; bytes: Buffer }): Promise<LoanDto> {
      const now = clock.now();
      const updated = await repo.setReceipt(
        pool,
        loanId,
        userId,
        { bytes: receipt.bytes, contentType: receipt.contentType, uploadedAt: now },
        today(now),
      );
      if (!updated) throw Errors.notFound('Loan not found.');
      return toLoanDto(updated);
    },

    /** The stored photo. Someone else's loan and a loan without a receipt both answer 404. */
    async getReceipt(userId: string, loanId: string): Promise<repo.StoredReceipt> {
      const receipt = await repo.findReceipt(pool, loanId, userId);
      if (!receipt) throw Errors.notFound('Receipt not found.');
      return receipt;
    },

    /** Removes the receipt. Removing one that is not there is not an error: the loan is returned as it is. */
    async removeReceipt(userId: string, loanId: string): Promise<LoanDto> {
      const now = clock.now();
      const updated = await repo.clearReceipt(pool, loanId, userId, today(now));
      if (!updated) throw Errors.notFound('Loan not found.');
      return toLoanDto(updated);
    },
  };
}

export type LoansService = ReturnType<typeof createLoansService>;
