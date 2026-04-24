/**
 * lib/auth/cookies.ts
 *
 * Helpers to set and clear the `naut_session` cookie.
 *
 * Cookie attributes:
 *   - httpOnly: prevents JS access
 *   - Secure: HTTPS only (set in production; omitted in local dev)
 *   - SameSite=Lax: CSRF protection while allowing normal navigation
 *   - Path=/: available to all routes
 *   - MaxAge: 60-day TTL matches DB session expires_at
 */

import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME =
  process.env.SESSION_COOKIE_NAME ?? 'naut_session';

const SESSION_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days

/**
 * Write the session token into the response cookie jar.
 * Must be called from a Server Action or Route Handler (not a Server Component).
 */
export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Read the session token from the incoming request cookies.
 * Returns null if the cookie is absent.
 */
export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  return cookie?.value ?? null;
}

/**
 * Clear the session cookie (expire immediately).
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
