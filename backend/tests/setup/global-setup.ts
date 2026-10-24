import dotenv from 'dotenv';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertSafeTestDatabase } from './db-guard';

/**
 * Runs once before the whole suite. Order matters: the guard runs FIRST, so migrations (and
 * every later connection) can only ever target a verified `*_test` database.
 */
export default async function globalSetup(): Promise<void> {
  const root = path.resolve(__dirname, '../..');
  dotenv.config({ path: path.join(root, '.env'), quiet: true });

  const testUrl = process.env.TEST_DATABASE_URL;
  assertSafeTestDatabase(testUrl, process.env.DATABASE_URL);

  const migrate = path.join(root, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js');
  try {
    execFileSync(
      process.execPath,
      [migrate, 'up', '--migrations-dir', 'migrations', '--database-url-var', 'TEST_DATABASE_URL'],
      {
        cwd: root,
        // Minimal environment on purpose: the child must not see DATABASE_URL at all.
        env: { PATH: process.env.PATH, TEST_DATABASE_URL: testUrl },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(`Could not apply migrations to the test database:\n${stderr}`);
  }
}
