/**
 * app/api/health/route.ts
 *
 * GET /api/health
 *
 * Healthcheck endpoint used by Railway to determine deploy health.
 * Returns 200 with a JSON payload indicating DB connectivity.
 *
 * Response:
 *   { ok: true, db: boolean, now: ISO timestamp }
 *
 * The `db` field is false (not an error) when the DB query fails —
 * the endpoint itself always returns 200 so Railway doesn't restart
 * the container due to a transient DB hiccup. The `db: false` signal
 * can be picked up by monitoring alerts separately.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';

// Always run fresh — never serve a cached health response
export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch (err) {
    console.error('[health] DB ping failed:', err);
  }

  return NextResponse.json({
    ok: true,
    db: dbOk,
    now: new Date().toISOString(),
  });
}
