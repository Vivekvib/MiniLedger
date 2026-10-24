/**
 * Phone and one-time-code input helpers. The server is the authority (it validates E.164
 * syntax only); this mirrors that rule so the user gets instant feedback, and adds one
 * convenience: a bare 10-digit number is assumed to be Indian (+91).
 */

const E164 = /^\+[1-9]\d{7,14}$/;

export const PHONE_ERROR =
  'Enter a 10-digit mobile number, or a full number with country code such as +911234567890.';

export const OTP_ERROR = 'Enter the 6-digit code.';

/** Returns the number in E.164 form (e.g. "+911234567890"), or null if it is not valid. */
export function normalizePhoneInput(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s\-().]/g, '');
  if (stripped === '') return null;

  let candidate: string;
  if (stripped.startsWith('+')) {
    candidate = stripped;
  } else if (/^0?\d{10}$/.test(stripped)) {
    candidate = `+91${stripped.slice(-10)}`;
  } else if (/^91\d{10}$/.test(stripped)) {
    candidate = `+${stripped}`;
  } else {
    return null;
  }
  return E164.test(candidate) ? candidate : null;
}

/** Digits only, at most six: what a one-time-code field can hold. */
export function sanitizeOtpInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export function isValidOtp(otp: string): boolean {
  return /^\d{6}$/.test(otp);
}
