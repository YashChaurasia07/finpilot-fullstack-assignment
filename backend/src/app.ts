import './lib/zod';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFound } from './middleware/errors';
import { requestLogger } from './middleware/requestLogger';
import { contentTypeGuard, originCheck } from './middleware/security';
import { buildApi, type ApiOptions } from './routes';

/** Built by a function (not at import time) so tests can create isolated instances. */
export function createApp(opts: ApiOptions = {}) {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY); // how many reverse proxies sit in front (real client IP for rate limits/logs)

  app.use(
    helmet({
      // "upgrade-insecure-requests" and HSTS only make sense over HTTPS; on plain-HTTP localhost they break Swagger UI.
      contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': config.COOKIE_SECURE ? [] : null } },
      strictTransportSecurity: config.COOKIE_SECURE,
    }),
  );
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true }));
  app.use(requestLogger);
  app.use(contentTypeGuard);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(originCheck);

  app.use('/api/v1', buildApi(opts));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
