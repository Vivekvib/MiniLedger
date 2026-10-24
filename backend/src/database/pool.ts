import { Pool, PoolClient, types } from 'pg';
import type { Logger } from '../utils/logger';

/**
 * Keep DATE and NUMERIC as strings.
 *
 * By default `pg` turns DATE into a JS Date in the server's local zone, which can shift the
 * calendar day. NUMERIC already arrives as a string, but it is pinned explicitly so a future
 * driver change can never route money through a float. Due dates stay `YYYY-MM-DD`.
 */
const PG_DATE_OID = 1082;
const PG_NUMERIC_OID = 1700;
types.setTypeParser(PG_DATE_OID, (value) => value);
types.setTypeParser(PG_NUMERIC_OID, (value) => value);

/** Anything that can run a query: the pool itself or a checked-out transaction client. */
export type Queryable = Pool | PoolClient;

export function createPool(databaseUrl: string, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client erroring (e.g. the database restarting) must not crash the process.
  pool.on('error', (err) => {
    logger.error({ errCode: (err as { code?: string }).code, errMessage: err.message }, 'idle database client error');
  });
  return pool;
}
