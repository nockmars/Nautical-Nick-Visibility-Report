/**
 * app/api/stripe/webhook/route.ts
 *
 * POST /api/stripe/webhook
 *
 * Receives Stripe webhook events. Signature is verified before any processing.
 *
 * CRITICAL: Must read the raw body with `await req.text()` — NOT `req.json()`.
 * Parsing to JSON and re-serializing alters the byte sequence and breaks the
 * Stripe HMAC signature check.
 *
 * To disable Next.js body parsing for this route we export a route segment
 * config with `export const dynamic = 'force-dynamic'` — App Router does not
 * buffer the body by default in Route Handlers, so no extra config is needed.
 * The raw text() call works as-is.
 *
 * Webhook URL registered in Stripe dashboard:
 *   {BASE_URL}/api/stripe/webhook
 */

import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent, handleWebhookEvent } from '@/lib/stripe/webhook';

// Force dynamic so Next.js never caches this route
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  // Read raw body — must NOT use req.json()
  const rawBody = await req.text();

  let event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[stripe/webhook] Signature verification failed:', message);
    return NextResponse.json({ error: `Webhook signature error: ${message}` }, { status: 400 });
  }

  try {
    const result = await handleWebhookEvent(event);
    console.log(`[stripe/webhook] ${event.type}: ${result}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[stripe/webhook] Handler error for ${event.type}:`, message);
    // Return 500 so Stripe retries the event
    return NextResponse.json({ error: 'Webhook handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
