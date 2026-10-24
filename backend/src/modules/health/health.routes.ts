import { Router } from 'express';
import type { Pool } from 'pg';
import type { Clock } from '../../utils/clock';

/** Liveness plus a real database round trip. A failed query becomes a 503 via the error handler. */
export function createHealthRouter(deps: { pool: Pool; clock: Clock }): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    await deps.pool.query('SELECT 1');
    res.json({ data: { status: 'ok', database: 'up', time: deps.clock.now().toISOString() } });
  });

  return router;
}
