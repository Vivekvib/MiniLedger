import type { Pool, PoolClient } from 'pg';

/**
 * Runs `work` inside one transaction. Commits if it resolves, rolls back if it throws.
 *
 * To persist a side effect AND report a failure (for example recording a failed OTP guess),
 * return a result object from `work` and throw after this function has committed. Throwing
 * inside `work` would roll the side effect back.
 */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; the original error is the useful one.
    }
    throw error;
  } finally {
    client.release();
  }
}
