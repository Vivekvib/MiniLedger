import type { RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { Errors } from '../../utils/errors';
import type { LoansService } from './loans.service';
import { idempotencyKeySchema, type CreateLoanBody, type UploadReceiptBody } from './loans.validation';

export function createLoansController(service: LoansService) {
  const create: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    const body = req.body as CreateLoanBody;

    let idempotencyKey: string | null = null;
    const rawKey = req.header('idempotency-key');
    if (rawKey !== undefined) {
      const parsed = idempotencyKeySchema.safeParse(rawKey);
      if (!parsed.success) {
        throw Errors.validation({ 'Idempotency-Key': parsed.error.issues[0]?.message ?? 'Invalid Idempotency-Key.' });
      }
      idempotencyKey = parsed.data;
    }

    const { loan, replayed } = await service.createLoan(userId, { ...body, idempotencyKey });
    if (replayed) res.set('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json({ data: loan });
  };

  const list: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    res.json({ data: { loans: await service.listLoans(userId) } });
  };

  const repay: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    const id = String(req.params.id);
    res.json({ data: await service.repayLoan(userId, id) });
  };

  const setReceipt: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    const body = req.body as UploadReceiptBody;
    res.json({ data: await service.setReceipt(userId, String(req.params.id), body) });
  };

  const getReceipt: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    const receipt = await service.getReceipt(userId, String(req.params.id));
    res.set({
      'Content-Type': receipt.contentType,
      'Content-Length': String(receipt.bytes.length),
      'Content-Disposition': 'inline',
      // Private data: shared caches must not keep it, and the app revalidates before reuse.
      'Cache-Control': 'private, no-cache',
    });
    res.send(receipt.bytes);
  };

  const removeReceipt: RequestHandler = async (req, res) => {
    const { userId } = requireAuth(req);
    res.json({ data: await service.removeReceipt(userId, String(req.params.id)) });
  };

  return { create, list, repay, setReceipt, getReceipt, removeReceipt };
}
