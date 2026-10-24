import { z } from 'zod';
import { normalizePhone } from '../../utils/phone';

const PHONE_MESSAGE = 'Enter a valid phone number with country code, for example +911234567890.';

const phone = z
  .string({ error: 'Phone number is required.' })
  .transform((value, ctx) => {
    const normalised = normalizePhone(value);
    if (normalised === null) {
      ctx.addIssue({ code: 'custom', message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return normalised;
  });

export const requestOtpSchema = z.object({ phone });

export const verifyOtpSchema = z.object({
  phone,
  otp: z
    .string({ error: 'Code is required.' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export type RequestOtpBody = z.infer<typeof requestOtpSchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;
