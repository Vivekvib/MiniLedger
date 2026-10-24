import { z } from 'zod';
import type { NewLoanInput } from '../types/api';
import { toIsoDate } from './dates';
import { parseAmountInput } from './money';

/**
 * Client-side validation of the add-loan form. It exists for instant feedback only: the server
 * validates everything again (and is the authority), and its field messages are shown next to
 * the same fields if they ever disagree. The rules mirror backend/src/modules/loans/loans.validation.ts.
 */

export const FRIEND_NAME_MAX = 80;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const friendName = z
  .string()
  .trim()
  .min(1, "Enter your friend's name.")
  .max(FRIEND_NAME_MAX, `Name must be ${FRIEND_NAME_MAX} characters or fewer.`)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), 'Name contains invalid characters.');

const amount = z.string().transform((raw, ctx) => {
  const result = parseAmountInput(raw);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: result.message });
    return z.NEVER;
  }
  return result.value;
});

const dueDate = z
  .date({ error: 'Choose a due date.' })
  .refine((date) => !Number.isNaN(date.getTime()), 'Choose a due date.')
  .refine(
    (date) => date.getFullYear() >= MIN_YEAR && date.getFullYear() <= MAX_YEAR,
    `Due date must be between the years ${MIN_YEAR} and ${MAX_YEAR}.`,
  )
  .transform(toIsoDate);

const loanFormSchema = z.object({ friendName, amount, dueDate });

export type LoanFormField = 'friendName' | 'amount' | 'dueDate';
export type LoanFormErrors = Partial<Record<LoanFormField, string>>;

export interface LoanFormValues {
  friendName: string;
  amountText: string;
  dueDate: Date;
}

export type LoanFormResult = { ok: true; input: NewLoanInput } | { ok: false; errors: LoanFormErrors };

export function validateLoanForm(values: LoanFormValues): LoanFormResult {
  const parsed = loanFormSchema.safeParse({
    friendName: values.friendName,
    amount: values.amountText,
    dueDate: values.dueDate,
  });
  if (parsed.success) return { ok: true, input: parsed.data };

  const errors: LoanFormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === 'friendName' || field === 'amount' || field === 'dueDate') && errors[field] === undefined) {
      errors[field] = issue.message;
    }
  }
  return { ok: false, errors };
}
