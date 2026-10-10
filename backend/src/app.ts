import express from 'express';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import type { Pool } from 'pg';
import type { Config } from './config/env';
import { ApiError } from './errors';
import { PageClient } from './integrations/page.client';
import { WebsiteClient } from './integrations/website.client';
import { createAuthenticator } from './middleware/authenticate';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { idempotency } from './middleware/idempotency';
import { requestId } from './middleware/request-id';
import { createNavigationRouter, createPublicRouter } from './modules/navigation/navigation.routes';
import { NavigationService } from './modules/navigation/navigation.service';
import type { Logger } from './observability/logger';

export function createApp(deps: { cfg: Config; pool: Pool; logger: Logger }) {
  const { cfg, pool, logger } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: cfg.RATE_LIMIT_PER_MINUTE,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', 'Too many requests.')),
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  // Liveness is minimal; readiness checks the database.
  app.get('/health', (_req, res) => void res.status(200).json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const svc = new NavigationService(pool, cfg, new WebsiteClient(cfg), new PageClient(cfg));
  const v1 = express.Router();
  v1.use('/public', createPublicRouter(svc, cfg.publicNavigationEnabled)); // opts out of auth explicitly
  v1.use(createAuthenticator(cfg));
  v1.use(createNavigationRouter(svc, idempotency(pool, logger)));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
