import { RequestHandler, Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import type { SummaryService } from './summary.service';

export function createSummaryRouter(deps: { service: SummaryService; authenticate: RequestHandler }): Router {
  const router = Router();

  router.get('/', deps.authenticate, async (req, res) => {
    const { userId } = requireAuth(req);
    res.json({ data: await deps.service.getSummary(userId) });
  });

  return router;
}
