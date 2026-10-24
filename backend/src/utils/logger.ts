import pino, { Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logger. Credentials are redacted defensively even though the code never
 * logs them on purpose: OTPs, bearer tokens and the Authorization header.
 * Phone numbers must be passed through `maskPhone` before logging.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        'authorization',
        'token',
        'otp',
        '*.token',
        '*.otp',
        '*.authorization',
      ],
      censor: '[redacted]',
    },
  });
}
