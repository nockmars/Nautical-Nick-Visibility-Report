/**
 * app/api/auth/me/route.ts
 *
 * GET /api/auth/me
 *
 * Returns the current user's auth state and Pro status.
 * Used by the frontend to gate paywall content.
 *
 * Response (authenticated):
 *   { user: { id, email }, isPro: boolean }
 *
 * Response (unauthenticated):
 *   { user: null, isPro: false }
 *
 * Always returns 200 — null user indicates anonymous state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, isPro, getUserWithSubscription } from '@/lib/auth/server';

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (!session) {
    return NextResponse.json({ user: null, isPro: false });
  }

  // Load subscription to determine Pro status
  const userWithSub = await getUserWithSubscription(session.userId);

  if (!userWithSub) {
    return NextResponse.json({ user: null, isPro: false });
  }

  return NextResponse.json({
    user: {
      id: userWithSub.id,
      email: userWithSub.email,
    },
    isPro: isPro(userWithSub),
  });
}
