import { RequestHandler, Router } from 'express';
import { validateBody } from '../../middleware/validate';
import type { RateLimiters } from '../../middleware/rate-limit';
import { createAuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import { requestOtpSchema, verifyOtpSchema } from './auth.validation';

export function createAuthRouter(deps: {
  service: AuthService;
  authenticate: RequestHandler;
  limiters: RateLimiters;
}): Router {
  const controller = createAuthController(deps.service);
  const router = Router();

  router.post('/request-otp', deps.limiters.otpRequest, validateBody(requestOtpSchema), controller.requestOtp);
  router.post('/verify-otp', deps.limiters.otpVerify, validateBody(verifyOtpSchema), controller.verifyOtp);
  router.get('/me', deps.authenticate, controller.me);
  router.post('/logout', deps.authenticate, controller.logout);

  return router;
}
