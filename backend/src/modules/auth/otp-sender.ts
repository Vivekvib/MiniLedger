import { maskPhone } from '../../utils/phone';

/**
 * How a one-time code reaches the user. MiniLedger ships only a development implementation
 * that prints to the server terminal. A real deployment would implement this interface with
 * an SMS provider; nothing else in the codebase would change.
 */
export interface OtpSender {
  send(phone: string, otp: string, expiresInSeconds: number): Promise<void>;
}

/**
 * MOCK delivery: writes the code to the terminal running the server.
 *
 * This writes straight to stdout, deliberately NOT through the structured logger, so the code
 * can never end up in shipped log pipelines. It refuses to run in production: a production
 * process that reaches this constructor fails at startup instead of printing codes.
 */
export function createConsoleOtpSender(nodeEnv: string): OtpSender {
  if (nodeEnv === 'production') {
    throw new Error(
      'The console OTP sender is a development-only mock and cannot run with NODE_ENV=production. ' +
        'Provide a real OtpSender (for example an SMS provider) before deploying.',
    );
  }
  return {
    async send(phone, otp, expiresInSeconds) {
      process.stdout.write(
        `\n[MiniLedger DEV OTP] ${maskPhone(phone)} -> ${otp}  (valid for ${Math.round(expiresInSeconds / 60)} min)\n\n`,
      );
    },
  };
}
