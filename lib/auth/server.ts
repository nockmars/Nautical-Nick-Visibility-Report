/**
 * lib/auth/server.ts
 *
 * Server-side auth helpers used by Route Handlers and Server Components.
 *
 * Usage:
 *   const session = await getSessionFromRequest(req);
 *   if (!session) return unauthorized();
 *   if (!isPro(session.user)) return forbidden();
 */

import { type NextRequest } from 'next/server';
import { prisma } from '@/lib/db/client';
import { getSession, type SessionWithUser } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';
import type { User, Subscription } from '@prisma/client';

export type { SessionWithUser };

/**
 * Extract the session token from the incoming request's cookie header,
 * then look up + validate the session in the DB.
 *
 * Returns null if:
 *   - No session cookie is present
 *   - The session token is not found
 *   - The session is expired
 */
export async function getSessionFromRequest(
  req: NextRequest,
): Promise<SessionWithUser | null> {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return getSession(token);
}

/**
 * Determine whether a user has an active Pro subscription.
 *
 * A subscription is considered active when:
 *   - The subscription row exists
 *   - status is 'active' or 'trialing'
 *   - currentPeriodEnd is in the future (belt-and-suspenders against stale webhook data)
 */
export function isPro(
  user: User & { subscription?: Subscription | null },
): boolean {
  const sub = user.subscription;
  if (!sub) return false;
  const isActiveStatus = sub.status === 'active' || sub.status === 'trialing';
  const isNotExpired = sub.currentPeriodEnd > new Date();
  return isActiveStatus && isNotExpired;
}

/**
 * Load a user's subscription inline (used when the user object doesn't include it).
 */
export async function getUserWithSubscription(
  userId: string,
): Promise<(User & { subscription: Subscription | null }) | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });
}

/**
 * Standard 401 response.
 */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Standard 403 response.
 */
export function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
