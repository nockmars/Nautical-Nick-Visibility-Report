/**
 * Tests for lib/stripe/webhook.ts
 *
 * Verifies:
 *   - constructWebhookEvent throws on bad signature
 *   - handleWebhookEvent routes each event type correctly
 *   - DB upsert logic for each event type
 *
 * Uses Jest manual mocks for stripe and prisma to avoid real network/DB calls.
 */

import type Stripe from 'stripe';

// ─────────────────────────────────────────────────────────────────────────────
// Mock environment variables BEFORE importing the modules under test
// ─────────────────────────────────────────────────────────────────────────────
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';

// ─────────────────────────────────────────────────────────────────────────────
// Mock @prisma/client
// ─────────────────────────────────────────────────────────────────────────────
const mockPrismaSubscription = {
  upsert: jest.fn().mockResolvedValue({}),
  findFirst: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
};

const mockPrismaUser = {
  findFirst: jest.fn(),
};

jest.mock('@/lib/db/client', () => ({
  prisma: {
    subscription: mockPrismaSubscription,
    user: mockPrismaUser,
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock stripe SDK
// ─────────────────────────────────────────────────────────────────────────────
const mockConstructEvent = jest.fn();
const mockRetrieveSubscription = jest.fn();

jest.mock('@/lib/stripe/client', () => ({
  stripe: {
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    subscriptions: {
      retrieve: mockRetrieveSubscription,
    },
  },
}));

// Import after mocks are set up
import { constructWebhookEvent, handleWebhookEvent } from '../webhook';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStripeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_test123',
    object: 'subscription',
    customer: 'cus_test123',
    status: 'active',
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    cancel_at_period_end: false,
    items: { object: 'list', data: [], has_more: false, url: '' },
    ...overrides,
  } as Stripe.Subscription;
}

function makeCheckoutSession(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test123',
    object: 'checkout.session',
    client_reference_id: 'user-123',
    customer: 'cus_test123',
    subscription: 'sub_test123',
    ...overrides,
  } as Stripe.Checkout.Session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('constructWebhookEvent', () => {
  it('returns the event when signature is valid', () => {
    const fakeEvent = { type: 'checkout.session.completed' } as Stripe.Event;
    mockConstructEvent.mockReturnValueOnce(fakeEvent);

    const result = constructWebhookEvent('raw-body', 'valid-sig');
    expect(result).toBe(fakeEvent);
    expect(mockConstructEvent).toHaveBeenCalledWith('raw-body', 'valid-sig', 'whsec_mock');
  });

  it('throws when signature is invalid', () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    expect(() => constructWebhookEvent('tampered-body', 'bad-sig')).toThrow(
      'No signatures found',
    );
  });
});

describe('handleWebhookEvent — checkout.session.completed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRetrieveSubscription.mockResolvedValue(makeStripeSubscription());
  });

  it('upserts subscription when client_reference_id is present', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: makeCheckoutSession() },
    } as Stripe.Event;

    const result = await handleWebhookEvent(event);

    expect(mockRetrieveSubscription).toHaveBeenCalledWith('sub_test123');
    expect(mockPrismaSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-123' },
        create: expect.objectContaining({
          userId: 'user-123',
          stripeCustomerId: 'cus_test123',
          stripeSubscriptionId: 'sub_test123',
          status: 'active',
          tier: 'pro',
        }),
      }),
    );
    expect(result).toContain('upserted subscription for user user-123');
  });

  it('skips when client_reference_id is missing', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: makeCheckoutSession({ client_reference_id: null }) },
    } as Stripe.Event;

    const result = await handleWebhookEvent(event);

    expect(mockPrismaSubscription.upsert).not.toHaveBeenCalled();
    expect(result).toContain('missing client_reference_id');
  });
});

describe('handleWebhookEvent — customer.subscription.updated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaUser.findFirst.mockResolvedValue({ id: 'user-456' });
  });

  it('syncs subscription when user is found by customer ID', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: { object: makeStripeSubscription({ status: 'past_due' }) },
    } as Stripe.Event;

    const result = await handleWebhookEvent(event);

    expect(mockPrismaSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-456' },
        update: expect.objectContaining({ status: 'past_due' }),
      }),
    );
    expect(result).toContain('synced subscription');
  });

  it('skips when no user is found for the customer ID', async () => {
    mockPrismaUser.findFirst.mockResolvedValue(null);

    const event = {
      type: 'customer.subscription.updated',
      data: { object: makeStripeSubscription() },
    } as Stripe.Event;

    const result = await handleWebhookEvent(event);

    expect(mockPrismaSubscription.upsert).not.toHaveBeenCalled();
    expect(result).toContain('no user found');
  });
});

describe('handleWebhookEvent — customer.subscription.deleted', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks subscription as canceled when found', async () => {
    mockPrismaSubscription.findFirst.mockResolvedValue({
      id: 'db-sub-1',
      stripeSubscriptionId: 'sub_test123',
    });

    const event = {
      type: 'customer.subscription.deleted',
      data: { object: makeStripeSubscription() },
    } as Stripe.Event;

    const result = await handleWebhookEvent(event);

    expect(mockPrismaSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'db-sub-1' },
        data: expect.objectContaining({ status: 'canceled' }),
      }),
    );
    expect(result).toContain('canceled');
  });

  it('skips when no subscription row exists', async () => {
    mockPrismaSubscription.findFirst.mockResolvedValue(null);

    const event = {
      type: 'customer.subscription.deleted',
      data: { object: makeStripeSubscription() },
    } as Stripe.Event;

    const result = await handleWebhookEvent(event);

    expect(mockPrismaSubscription.update).not.toHaveBeenCalled();
    expect(result).toContain('no subscription row');
  });
});

describe('handleWebhookEvent — unhandled event type', () => {
  it('returns an unhandled message without throwing', async () => {
    const event = {
      type: 'some.unknown.event',
      data: { object: {} },
    } as unknown as Stripe.Event;

    const result = await handleWebhookEvent(event);
    expect(result).toContain('unhandled event type: some.unknown.event');
  });
});

describe('Stripe status mapping', () => {
  it('maps incomplete_expired to canceled', async () => {
    mockRetrieveSubscription.mockResolvedValue(
      makeStripeSubscription({ status: 'incomplete_expired' }),
    );

    const event = {
      type: 'checkout.session.completed',
      data: { object: makeCheckoutSession() },
    } as Stripe.Event;

    await handleWebhookEvent(event);

    expect(mockPrismaSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: 'canceled' }),
      }),
    );
  });
});
