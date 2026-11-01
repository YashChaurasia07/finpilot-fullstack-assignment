import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { userRole } from '../db/schema';
import { AppError } from '../lib/errors';

export type Role = (typeof userRole.enumValues)[number];
export interface AuthUser {
  id: number;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const COOKIE_NAME = 'finpilot_token';

/** Cookie settings shared by login (set) and logout (clear). httpOnly keeps the token out of reach of page scripts. */
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.COOKIE_SECURE,
  path: '/',
} as const;

const isRole = (value: unknown): value is Role => value === 'VIEWER' || value === 'ADMIN';

/** Stateless check: verifies the signed cookie and attaches { id, role } to the request. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[COOKIE_NAME];
  if (typeof token !== 'string' || !token) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  try {
    const claims = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof claims === 'string' || !claims.sub || !isRole(claims.role)) throw new Error('unexpected claims');
    req.user = { id: Number(claims.sub), role: claims.role };
  } catch (err) {
    const expired = err instanceof jwt.TokenExpiredError;
    throw new AppError(401, 'UNAUTHENTICATED', expired ? 'Your session expired. Sign in again.' : 'Invalid session. Sign in again.');
  }
  next();
};

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (req.user?.role !== role) throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
    next();
  };
