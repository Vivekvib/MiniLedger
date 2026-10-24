import dotenv from 'dotenv';
import path from 'node:path';
import { assertSafeTestDatabase } from './db-guard';

let cached: string | undefined;

/**
 * The only way test code obtains a database URL. It re-runs the guard (guard layer 2) every
 * time the suite starts a context, so a test file can never bypass globalSetup by accident.
 */
export function getTestDatabaseUrl(): string {
  if (cached) return cached;
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  assertSafeTestDatabase(url, process.env.DATABASE_URL);
  cached = url as string;
  return cached;
}
