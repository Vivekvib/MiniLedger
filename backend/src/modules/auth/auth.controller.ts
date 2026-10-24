import type { RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import type { AuthService } from './auth.service';
import type { RequestOtpBody, VerifyOtpBody } from './auth.validation';

/** Thin HTTP adapters: unpack the request, call the service, wrap the result. */
export function createAuthController(service: AuthService) {
  const requestOtp: RequestHandler = async (req, res) => {
    const { phone } = req.body as RequestOtpBody;
    res.json({ data: await service.requestOtp(phone) });
  };

  const verifyOtp: RequestHandler = async (req, res) => {
    const { phone, otp } = req.body as VerifyOtpBody;
    res.json({ data: await service.verifyOtp(phone, otp) });
  };

  const me: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    res.json({ data: { user: await service.getMe(userId) } });
  };

  const logout: RequestHandler = async (req, res) => {
    const { sessionId } = requireAuth(req);
    await service.logout(sessionId);
    res.json({ data: { loggedOut: true } });
  };

  return { requestOtp, verifyOtp, me, logout };
}
