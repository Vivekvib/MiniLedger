import { z } from 'zod';
import { isDueDateInSupportedRange, isValidIsoDate, MAX_DUE_YEAR, MIN_DUE_YEAR } from '../../utils/app-date';
import { parseAmount } from '../../utils/money';
import { decodeReceipt, RECEIPT_CONTENT_TYPES, RECEIPT_MESSAGES } from '../../utils/receipt-image';

const AMOUNT_MESSAGES = {
  required: 'Amount is required.',
  not_positive: 'Amount must be greater than 0.',
  format: 'Enter a valid amount with at most 2 decimal places (up to 10 digits before the decimal point).',
} as const;

const friendName = z
  .string({ error: 'Friend name is required.' })
  .trim()
  .min(1, 'Friend name is required.')
  .max(80, 'Friend name must be 80 characters or fewer.')
  // eslint-disable-next-line no-control-regex
  .refine((v) => !/[\u0000-\u001F\u007F]/.test(v), 'Friend name contains invalid characters.');

/** Accepts a decimal string or a JSON number; yields a fixed two-decimal string like "1500.00". */
const amount = z.unknown().transform((value, ctx) => {
  const result = parseAmount(value);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_MESSAGES[result.reason] });
    return z.NEVER;
  }
  return result.value;
});

const dueDate = z
  .string({ error: 'Due date is required.' })
  .trim()
  .min(1, 'Due date is required.')
  .refine(isValidIsoDate, 'Enter a valid due date in YYYY-MM-DD format.')
  .refine(isDueDateInSupportedRange, `Due date must be between the years ${MIN_DUE_YEAR} and ${MAX_DUE_YEAR}.`);

export const createLoanSchema = z.object({ friendName, amount, dueDate });
export type CreateLoanBody = z.infer<typeof createLoanSchema>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loanIdParamSchema = z.object({
  id: z.string().regex(UUID, 'Loan id must be a valid UUID.'),
});

/** The optional `Idempotency-Key` request header: a UUID, lower-cased for storage. */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(UUID, 'Idempotency-Key must be a UUID.')
  .transform((v) => v.toLowerCase());

/**
 * Body of PUT /loans/:id/receipt: the photo as base64 text plus its type. The result carries the
 * decoded bytes, already checked for size and for a real image signature.
 */
export const uploadReceiptSchema = z
  .object({
    contentType: z.enum(RECEIPT_CONTENT_TYPES, { error: 'Content type must be image/jpeg, image/png or image/webp.' }),
    data: z.string({ error: 'Image data is required.' }).min(1, 'Image data is required.'),
  })
  .transform((value, ctx) => {
    const decoded = decodeReceipt(value.contentType, value.data);
    if (!decoded.ok) {
      const message =
        decoded.reason === 'not_an_image' ? RECEIPT_MESSAGES.not_an_image(value.contentType) : RECEIPT_MESSAGES[decoded.reason];
      ctx.addIssue({ code: 'custom', message, path: ['data'] });
      return z.NEVER;
    }
    return { contentType: value.contentType, bytes: decoded.bytes };
  });
export type UploadReceiptBody = z.infer<typeof uploadReceiptSchema>;
