import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { authenticate, COOKIE_NAME, cookieOptions } from '../middleware/auth';
import { ok } from '../lib/respond';
import { getUser, signToken, verifyCredentials } from '../services/auth';

const loginBody = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address')),
  // bcrypt only looks at the first 72 bytes; refusing longer input avoids silent truncation and wasted CPU.
  password: z
    .string()
    .min(1, 'Required')
    .refine((p) => Buffer.byteLength(p) <= 72, 'Must be at most 72 bytes'),
});

export function authRoutes(loginLimiter: RequestHandler) {
  const router = Router();

  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = loginBody.parse(req.body ?? {});
    const user = await verifyCredentials(email, password);
    res.cookie(COOKIE_NAME, signToken(user), { ...cookieOptions, maxAge: config.JWT_EXPIRES_HOURS * 3_600_000 });
    ok(res, { user });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions);
    ok(res, { loggedOut: true });
  });

  router.get('/me', authenticate, async (req, res) => {
    ok(res, { user: await getUser(req.user!.id) });
  });

  return router;
}
