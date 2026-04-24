/**
 * lib/stripe/client.ts
 *
 * Stripe SDK singleton.
 *
 * The singleton pattern avoids creating multiple Stripe instances during
 * Next.js HMR in development. In production there is one instance per process.
 */

import Stripe from 'stripe';

// Defer validation to runtime so `next build` doesn't fail if STRIPE_SECRET_KEY
// is only available in Railway env at deploy time (not at build time).
const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';

export const stripe = new Stripe(stripeKey || 'sk_placeholder_build_only', {
  // Pin the API version so upgrades are explicit and reviewed.
  apiVersion: '2025-02-24.acacia',
  typescript: true,
});

/**
 * Call this at the start of any Stripe route handler to guard against
 * missing env vars at runtime.
 */
export function requireStripeKey(): void {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY environment variable is not set');
  }
}
