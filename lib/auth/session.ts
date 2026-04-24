/**
 * lib/auth/session.ts
 *
 * DB-backed session management.
 *
 * Sessions are stored in the `sessions` table. Each session has:
 *   - A unique token (64-byte random hex string) used as the cookie value.
 *   - An expiry time 60 days from creation.
 *   - Optional user-agent and IP for audit purposes.
 *
 * The session row is looked up on every authenticated request; expired rows
 * are rejected and cleaned up lazily (no scheduled job needed at this scale).
 */

import { randomBytes } from 'crypto';
import { prisma } from '@/lib/db/client';
import type { User, Session } from '@prisma/client';

const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days in ms

export type SessionWithUser = Session & { user: User };

/**
 * Generate a cryptographically random session token (64-byte hex = 128 chars).
 */
function generateToken(): string {
  return randomBytes(64).toString('hex');
}

/**
 * Create a new session in the DB and return the token to be stored in the cookie.
 */
export async function createSession(
  userId: string,
  opts: { userAgent?: string; ip?: string } = {},
): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt,
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
    },
  });

  return token;
}

/**
 * Look up a session by token.
 * Returns null if the token is not found or has expired.
 * Expired sessions are deleted as a side effect (lazy cleanup).
 */
export async function getSession(token: string): Promise<SessionWithUser | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) return null;

  if (session.expiresAt < new Date()) {
    // Lazy expiry cleanup — fire-and-forget
    prisma.session.delete({ where: { token } }).catch(() => undefined);
    return null;
  }

  return session;
}

/**
 * Delete a session from the DB (used by logout).
 * Silently ignores missing tokens.
 */
export async function destroySession(token: string): Promise<void> {
  await prisma.session.delete({ where: { token } }).catch(() => undefined);
}

/**
 * Delete all sessions for a user (used when account is deleted or password changed).
 */
export async function destroyAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
