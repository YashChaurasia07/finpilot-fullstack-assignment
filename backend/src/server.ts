import { createApp } from './app';
import { config } from './config';
import { pool } from './db/client';
import { logger } from './lib/logger';

const server = createApp().listen(config.PORT, () => {
  logger.info(`FinPilot API listening on :${config.PORT} (docs at /api/v1/docs)`);
});
server.requestTimeout = 30_000; // slow or stalled clients cannot hold a connection forever

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'shutting down: draining connections');
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(() => {
    pool
      .end()
      .catch((err) => logger.error({ err }, 'error while closing the database pool'))
      .finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// An unexpected crash is logged with context and the process exits so the container manager can restart it cleanly.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
