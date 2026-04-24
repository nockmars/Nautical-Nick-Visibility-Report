/**
 * app/api/auth/logout/route.ts
 *
 * POST /api/auth/logout
 *
 * Destroys the session in the DB and clears the naut_session cookie.
 * Always returns 200 — no error if no session exists (idempotent).
 */

import { NextRequest, NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth/session';
import { clearSessionCookie } from '@/lib/auth/cookies';

export async function POST(req: NextRequest) {
  // Read token from cookie without going through full session validation
  // (we want to clear it even if it's expired)
  const token = req.cookies.get(
    process.env.SESSION_COOKIE_NAME ?? 'naut_session',
  )?.value;

  if (token) {
    await destroySession(token);
  }

  await clearSessionCookie();

  return NextResponse.json({ ok: true });
}
