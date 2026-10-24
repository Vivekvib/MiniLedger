import express, { RequestHandler, Router } from 'express';
import { validateBody, validateParams } from '../../middleware/validate';
import { createLoansController } from './loans.controller';
import type { LoansService } from './loans.service';
import { RECEIPT_REQUEST_LIMIT_BYTES } from '../../utils/receipt-image';
import { createLoanSchema, loanIdParamSchema, uploadReceiptSchema } from './loans.validation';

export function createLoansRouter(deps: { service: LoansService; authenticate: RequestHandler }): Router {
  const controller = createLoansController(deps.service);
  const router = Router();

  // Every loan route requires a valid, unrevoked session.
  router.use(deps.authenticate);
  router.post('/', validateBody(createLoanSchema), controller.create);
  router.get('/', controller.list);
  router.patch('/:id/repay', validateParams(loanIdParamSchema), controller.repay);

  // Receipt photo. The upload body can be several MB, so it is parsed here, AFTER authenticate
  // (above) has accepted the request, with its own limit. app.ts skips its small global parser
  // for this one route. Everything else in the API stays limited to 10 KB.
  router.put(
    '/:id/receipt',
    validateParams(loanIdParamSchema),
    express.json({ limit: RECEIPT_REQUEST_LIMIT_BYTES }),
    validateBody(uploadReceiptSchema),
    controller.setReceipt,
  );
  router.get('/:id/receipt', validateParams(loanIdParamSchema), controller.getReceipt);
  router.delete('/:id/receipt', validateParams(loanIdParamSchema), controller.removeReceipt);

  return router;
}
