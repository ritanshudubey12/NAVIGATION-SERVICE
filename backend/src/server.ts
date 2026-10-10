import { createApp } from './app';
import { loadConfig } from './config/env';
import { createPool } from './db/pool';
import { startOutboxPublisher } from './events/outbox.publisher';
import { createLogger } from './observability/logger';

// Fail fast on missing/invalid configuration or secrets.
const cfg = loadConfig();
const logger = createLogger(cfg.LOG_LEVEL);
const pool = createPool({ host: cfg.DB_HOST, port: cfg.DB_PORT, database: cfg.DB_NAME, max: cfg.DB_POOL_MAX });

const app = createApp({ cfg, pool, logger });
const outbox = startOutboxPublisher(pool, cfg, logger);
const server = app.listen(cfg.PORT, () => logger.info({ port: cfg.PORT }, 'navigation-api listening'));
server.requestTimeout = cfg.REQUEST_TIMEOUT_MS;

// Graceful shutdown: stop accepting, drain in-flight requests, close the pool.
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  outbox.stop();
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
