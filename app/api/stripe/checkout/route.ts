/**
 * app/api/stripe/checkout/route.ts
 *
 * POST /api/stripe/checkout
 *
 * Creates a Stripe Checkout session for the Pro subscription.
 * Requires an authenticated session — anonymous users cannot subscribe.
 *
 * Request body: { plan: "monthly" | "annual" }
 * - "monthly" → STRIPE_PRICE_ID_MONTHLY
 * - "annual"  → STRIPE_PRICE_ID_ANNUAL
 * - Defaults to "monthly" if body is missing or invalid.
 *
 * Response: { url: string }
 * - The frontend redirects to this URL.
 * - On completion, Stripe redirects back to {BASE_URL}/?stripe_success=1
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { getSessionFromRequest, unauthorized } from '@/lib/auth/server';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BASE_URL ?? 'http://localhost:3000';

type Plan = 'monthly' | 'annual';

function priceIdFor(plan: Plan): string | undefined {
  if (plan === 'annual') return process.env.STRIPE_PRICE_ID_ANNUAL;
  return process.env.STRIPE_PRICE_ID_MONTHLY;
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return unauthorized();

  let plan: Plan = 'monthly';
  try {
    const body = (await req.json()) as { plan?: string };
    if (body.plan === 'annual' || body.plan === 'monthly') {
      plan = body.plan;
    }
  } catch {
    // body is optional — default to monthly
  }

  const resolvedPriceId = priceIdFor(plan);

  if (!resolvedPriceId) {
    return NextResponse.json(
      { error: `No Stripe price ID configured for plan "${plan}"` },
      { status: 500 },
    );
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: resolvedPriceId, quantity: 1 }],
    // client_reference_id links the checkout to our user row.
    // The webhook uses this to associate the Stripe customer with the user.
    client_reference_id: session.userId,
    // metadata.plan lets the webhook know which tier they purchased
    metadata: { plan, userId: session.userId },
    success_url: `${BASE_URL}/?stripe_success=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE_URL}/?stripe_canceled=1`,
    automatic_tax: { enabled: true },
  });

  if (!checkoutSession.url) {
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: checkoutSession.url });
}
