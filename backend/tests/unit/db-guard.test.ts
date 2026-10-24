import { assertConnectedToTestDatabase, assertSafeTestDatabase } from '../setup/db-guard';
import type { Queryable } from '../../src/database/pool';
import { resetDatabase } from '../setup/test-app';
import type { Pool } from 'pg';

const DEV = 'postgres://u:p@localhost:5432/miniledger_dev';
const GOOD = 'postgres://u:p@localhost:5432/miniledger_test';

describe('assertSafeTestDatabase', () => {
  it('accepts a loopback *_test database that differs from the dev database', () => {
    expect(() => assertSafeTestDatabase(GOOD, DEV)).not.toThrow();
    expect(() => assertSafeTestDatabase('postgres://u:p@127.0.0.1:5433/x_test', DEV)).not.toThrow();
    expect(() => assertSafeTestDatabase('postgresql://u:p@[::1]:5432/x_test', DEV)).not.toThrow();
  });

  it('refuses when TEST_DATABASE_URL is missing (no fallback to DATABASE_URL)', () => {
    expect(() => assertSafeTestDatabase(undefined, DEV)).toThrow(/never fall back/);
  });

  it('refuses the development database by name', () => {
    expect(() => assertSafeTestDatabase(DEV, DEV)).toThrow(/_test/);
  });

  it('refuses a database whose name does not end in _test', () => {
    expect(() => assertSafeTestDatabase('postgres://u:p@localhost:5432/miniledger_test_backup', DEV)).toThrow(/must end with "_test"/);
    expect(() => assertSafeTestDatabase('postgres://u:p@localhost:5432/production', DEV)).toThrow(/must end with "_test"/);
  });

  it('refuses a remote host even with a _test name', () => {
    expect(() => assertSafeTestDatabase('postgres://u:p@db.example.com:5432/miniledger_test', DEV)).toThrow(/localhost/);
  });

  it('refuses host overrides smuggled in through the query string', () => {
    expect(() => assertSafeTestDatabase(`${GOOD}?host=db.example.com`, DEV)).toThrow(/"host" query parameter/);
    expect(() => assertSafeTestDatabase(`${GOOD}?hostaddr=10.0.0.5`, DEV)).toThrow(/"hostaddr" query parameter/);
  });

  it('refuses when test and dev URLs resolve to the same database', () => {
    const sameName = 'postgres://u:p@localhost:5432/shared_test';
    expect(() => assertSafeTestDatabase(sameName, sameName)).toThrow(/same database/);
  });

  it('refuses malformed or non-postgres URLs', () => {
    expect(() => assertSafeTestDatabase('not a url', DEV)).toThrow(/not a valid URL/);
    expect(() => assertSafeTestDatabase('mysql://u:p@localhost/x_test', DEV)).toThrow(/postgres/);
  });

  it('never echoes the password in an error message', () => {
    try {
      assertSafeTestDatabase('postgres://admin:s3cr3t-pw@db.example.com:5432/prod', DEV);
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cr3t-pw');
    }
  });
});

function fakeDb(databaseName: string): Queryable {
  return { query: async () => ({ rows: [{ name: databaseName }] }) } as unknown as Queryable;
}

describe('assertConnectedToTestDatabase', () => {
  it('passes for a *_test connection', async () => {
    await expect(assertConnectedToTestDatabase(fakeDb('miniledger_test'))).resolves.toBe('miniledger_test');
  });

  it('refuses a connection that is really on another database', async () => {
    await expect(assertConnectedToTestDatabase(fakeDb('miniledger_dev'))).rejects.toThrow(/does not end with "_test"/);
  });
});

describe('resetDatabase', () => {
  it('truncates nothing when the live connection is not a test database', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ name: 'miniledger_dev' }] };
      },
    } as unknown as Pool;

    await expect(resetDatabase(pool)).rejects.toThrow(/does not end with "_test"/);
    expect(queries.some((q) => /TRUNCATE/i.test(q))).toBe(false);
  });
});
