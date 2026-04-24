/**
 * lib/stripe/webhook.ts
 *
 * Stripe webhook signature verification + event handlers.
 *
 * CRITICAL: The raw request body must be passed here, not a parsed JSON object.
 * In App Router route handlers, use `await req.text()` to get the raw body.
 * Passing a re-serialized JSON object will break signature verification.
 *
 * Handled events:
 *   - checkout.session.completed      → link Stripe customer to user, create/update subscription
 *   - customer.subscription.updated   → sync status + period end
 *   - customer.subscription.deleted   → mark subscription as canceled
 */

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe/client';
import { prisma } from '@/lib/db/client';

// WEBHOOK_SECRET is read at call time (not module load) so `next build` passes
// even when STRIPE_WEBHOOK_SECRET is only set in Railway env vars.
function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * Verify the Stripe webhook signature and construct the event.
 * Throws if signature is invalid.
 */
export function constructWebhookEvent(
  rawBody: string,
  signature: string,
): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret());
}

/**
 * Route a verified Stripe event to the appropriate handler.
 * Returns a summary string for logging.
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutSessionCompleted(
        event.data.object as Stripe.Checkout.Session,
      );

    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(
        event.data.object as Stripe.Subscription,
      );

    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(
        event.data.object as Stripe.Subscription,
      );

    default:
      return `unhandled event type: ${event.type}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<string> {
  const userId = session.client_reference_id;
  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;

  if (!userId) {
    return 'checkout.session.completed: missing client_reference_id, skipping';
  }
  if (!customerId || !subscriptionId) {
    return 'checkout.session.completed: missing customer or subscription ID, skipping';
  }

  // Fetch full subscription from Stripe to get status + period end
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);

  await upsertSubscription(userId, customerId, stripeSubscription);

  return `checkout.session.completed: upserted subscription for user ${userId}`;
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
): Promise<string> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const user = await prisma.user.findFirst({
    where: { subscription: { stripeCustomerId: customerId } },
  });

  if (!user) {
    return `customer.subscription.updated: no user found for customer ${customerId}`;
  }

  await upsertSubscription(user.id, customerId, subscription);

  return `customer.subscription.updated: synced subscription ${subscription.id} for user ${user.id}`;
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<string> {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const existing = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!existing) {
    return `customer.subscription.deleted: no subscription row for customer ${customerId}`;
  }

  await prisma.subscription.update({
    where: { id: existing.id },
    data: {
      status: 'canceled',
      updatedAt: new Date(),
    },
  });

  return `customer.subscription.deleted: marked subscription ${subscription.id} as canceled`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared upsert helper
// ─────────────────────────────────────────────────────────────────────────────

async function upsertSubscription(
  userId: string,
  stripeCustomerId: string,
  stripeSubscription: Stripe.Subscription,
): Promise<void> {
  const currentPeriodEnd = new Date(
    stripeSubscription.current_period_end * 1000,
  );

  // Map Stripe status to our enum — only values we defined in the schema
  type SubStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
  const statusMap: Record<string, SubStatus> = {
    active: 'active',
    canceled: 'canceled',
    past_due: 'past_due',
    trialing: 'trialing',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    unpaid: 'past_due',
    paused: 'canceled',
  };
  const status: SubStatus = statusMap[stripeSubscription.status] ?? 'incomplete';

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscription.id,
      status,
      tier: 'pro',
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      updatedAt: new Date(),
    },
    create: {
      userId,
      stripeCustomerId,
      stripeSubscriptionId: stripeSubscription.id,
      status,
      tier: 'pro',
      currentPeriodEnd,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    },
  });
}
