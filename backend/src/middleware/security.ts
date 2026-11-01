import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** CSRF defence for cookie auth: browsers always send Origin on cross-site writes, so unknown origins are refused. */
export const originCheck: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;
  if (!SAFE_METHODS.has(req.method) && origin && !config.CORS_ORIGINS.includes(origin)) {
    throw new AppError(403, 'FORBIDDEN', 'This origin is not allowed to call the API');
  }
  next();
};

/** Writes must be JSON (or multipart for the CSV import). Anything else is refused before any parsing. */
export const contentTypeGuard: RequestHandler = (req, _res, next) => {
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!SAFE_METHODS.has(req.method) && hasBody && !req.is(['application/json', 'multipart/form-data'])) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json');
  }
  next();
};

const limiter = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
  });

export const loginLimiter = (max: number) => limiter(15 * 60_000, max, 'Too many sign-in attempts. Try again in a few minutes.');
export const apiLimiter = (perMinute: number) => limiter(60_000, perMinute, 'Too many requests. Slow down and retry shortly.');
