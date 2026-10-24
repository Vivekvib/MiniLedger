import type { Queryable } from '../../src/database/pool';

/**
 * Guards that keep the test suite away from any database that could hold real data.
 * Layers (see docs/testing.md):
 *   1. `npm test` sets NODE_ENV=test, and config then reads TEST_DATABASE_URL only.
 *   2. assertSafeTestDatabase(): the URL must name a `*_test` database on a loopback host,
 *      and must not match DATABASE_URL. Runs in Jest globalSetup before any connection.
 *   3. assertConnectedToTestDatabase(): asks the live connection for current_database().
 *   4. Cleanup only TRUNCATEs four named tables and never drops anything.
 *
 * Error messages never echo the URL, because it contains a password.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FORBIDDEN_QUERY_PARAMS = ['host', 'hostaddr', 'service'];

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function endpoint(url: URL): string {
  return `${url.hostname}:${url.port || '5432'}/${databaseName(url)}`;
}

export function assertSafeTestDatabase(testUrl: string | undefined, devUrl?: string): void {
  if (!testUrl) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Tests never fall back to DATABASE_URL. ' +
        'Set TEST_DATABASE_URL in backend/.env (see .env.example).',
    );
  }

  let url: URL;
  try {
    url = new URL(testUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('TEST_DATABASE_URL must be a postgres:// or postgresql:// URL.');
  }

  // pg honours ?host=... and would connect there instead of the URL's host.
  for (const param of FORBIDDEN_QUERY_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new Error(`TEST_DATABASE_URL must not use the "${param}" query parameter.`);
    }
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Refusing to run tests: TEST_DATABASE_URL must point at localhost, 127.0.0.1 or ::1.');
  }

  const name = databaseName(url);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run tests: the test database name "${name}" must end with "_test".`);
  }

  if (devUrl) {
    let dev: URL | null = null;
    try {
      dev = new URL(devUrl);
    } catch {
      // An unparseable DATABASE_URL cannot be the same database; the checks above still hold.
    }
    if (dev && (databaseName(dev) === name || endpoint(dev) === endpoint(url))) {
      throw new Error('Refusing to run tests: TEST_DATABASE_URL points at the same database as DATABASE_URL.');
    }
  }
}

/** Asks the live connection which database it is really on. Throws unless it ends in `_test`. */
export async function assertConnectedToTestDatabase(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name');
  const name = rows[0]?.name ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to modify data: connected database "${name}" does not end with "_test".`);
  }
  return name;
}
