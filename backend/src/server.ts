import dotenv from 'dotenv';
import { createApp } from './app';
import { loadConfig, type AppConfig } from './config/env';
import { createPool } from './database/pool';
import { createConsoleOtpSender } from './modules/auth/otp-sender';
import { systemClock } from './utils/clock';
import { createLogger } from './utils/logger';

async function main(): Promise<void> {
  dotenv.config({ quiet: true });

  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    // Logger is not available before config is valid, so this one message goes to stderr.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  const pool = createPool(config.databaseUrl, logger);

  // Fail fast with a clear message instead of serving 503s from a server that can never work.
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    logger.fatal(
      { errMessage: error instanceof Error ? error.message : String(error) },
      'Cannot connect to PostgreSQL. Is it running, and is DATABASE_URL correct? See docs/troubleshooting.md.',
    );
    await pool.end().catch(() => undefined);
    process.exit(1);
  }

  const app = createApp({
    config,
    pool,
    clock: systemClock,
    otpSender: createConsoleOtpSender(config.env),
    logger,
  });

  const server = app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host, env: config.env, timezone: config.appTimezone }, 'MiniLedger API listening');
    process.stdout.write(
      '\nMOCK AUTHENTICATION: one-time codes are printed in THIS terminal and are never returned by the API.\n\n',
    );
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal({ port: config.port }, 'Port is already in use. Change PORT in .env or stop the other process.');
    } else {
      logger.fatal({ errMessage: error.message }, 'server error');
    }
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    // Force exit if connections refuse to drain.
    const forceTimer = setTimeout(() => {
      logger.error('forced shutdown after 10s');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    server.close(() => {
      pool
        .end()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
