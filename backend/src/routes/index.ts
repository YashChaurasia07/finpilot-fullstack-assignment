import { Router } from 'express';
import { config } from '../config';
import { authenticate, requireRole } from '../middleware/auth';
import { apiLimiter, loginLimiter } from '../middleware/security';
import { authRoutes } from './auth';
import { customerRoutes } from './customers';
import { docsRoutes } from './docs';
import { goalRoutes } from './goals';
import { healthRoutes } from './health';
import { importRoutes } from './imports';
import { instrumentRoutes } from './instruments';

export interface ApiOptions {
  loginLimit?: number;
}

/** Everything under /api/v1. Public routes first, then everything behind sign-in, then admin-only. */
export function buildApi(opts: ApiOptions = {}): Router {
  const api = Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store'); // customer data must never be cached by browsers or proxies
    next();
  });

  // public
  api.use('/health', healthRoutes); // before the rate limiter so health checks never get throttled
  api.use(docsRoutes);
  api.use(apiLimiter(config.API_RATE_LIMIT_PER_MIN));
  api.use('/auth', authRoutes(loginLimiter(opts.loginLimit ?? config.LOGIN_RATE_LIMIT_MAX)));

  // signed-in users
  api.use(authenticate);
  api.use('/customers', customerRoutes);
  api.use('/goals', goalRoutes);
  api.use('/instruments', instrumentRoutes);

  // admins only
  api.use('/admin/imports', requireRole('ADMIN'), importRoutes);
  return api;
}
