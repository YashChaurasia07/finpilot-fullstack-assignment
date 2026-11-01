import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../db/client';
import { users } from '../db/schema';
import { AppError } from '../lib/errors';
import type { Role } from '../middleware/auth';

export interface PublicUser {
  id: number;
  email: string;
  fullName: string;
  role: Role;
}

const publicColumns = { id: users.id, email: users.email, fullName: users.fullName, role: users.role };

// Compared against when the email is unknown, so "no such user" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 10);

export async function verifyCredentials(email: string, password: string): Promise<PublicUser> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));
  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  const { passwordHash: _omit, ...pub } = user;
  return pub;
}

export function signToken(user: PublicUser): string {
  return jwt.sign({ role: user.role }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.JWT_EXPIRES_HOURS * 3600,
  });
}

/** Re-reads the user so a deleted account stops being "signed in" at the next /auth/me. */
export async function getUser(id: number): Promise<PublicUser> {
  const [user] = await db.select(publicColumns).from(users).where(eq(users.id, id));
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'This account no longer exists. Sign in again.');
  return user;
}
