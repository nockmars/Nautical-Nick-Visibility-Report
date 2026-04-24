/**
 * app/api/auth/login/route.ts
 *
 * POST /api/auth/login
 *
 * Request body: { email: string, password: string }
 *
 * Verifies credentials, creates a session, sets the naut_session cookie.
 *
 * Timing safety: when no user is found, we run verifyPassword against a DUMMY_HASH
 * so the response time is indistinguishable from a real wrong-password attempt.
 * This prevents user enumeration via timing side-channel.
 *
 * Error responses use a generic message regardless of whether the email exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { verifyPassword, DUMMY_HASH } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/cookies';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

const GENERIC_ERROR = 'Invalid email or password';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    // Burn Argon2 cycles even when user is not found — timing-safe path
    await verifyPassword(password, DUMMY_HASH);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  // Update last login timestamp — fire and forget
  prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => undefined);

  const token = await createSession(user.id, {
    userAgent: req.headers.get('user-agent') ?? undefined,
    ip: req.headers.get('x-forwarded-for') ?? undefined,
  });

  await setSessionCookie(token);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
    },
  });
}
