/**
 * Tests for lib/auth/server.ts
 *
 * Verifies isPro() logic covers all subscription status/expiry combinations.
 */

import { isPro } from '../server';
import type { User, Subscription } from '@prisma/client';

// Build a minimal user fixture
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    username: null,
    passwordHash: 'hash',
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Build a minimal subscription fixture
function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return {
    id: 'sub-1',
    userId: 'user-1',
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_test',
    status: 'active',
    tier: 'pro',
    currentPeriodEnd: future,
    cancelAtPeriodEnd: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('isPro()', () => {
  it('returns true for active subscription with future period end', () => {
    const user = { ...makeUser(), subscription: makeSub({ status: 'active' }) };
    expect(isPro(user)).toBe(true);
  });

  it('returns true for trialing subscription with future period end', () => {
    const user = { ...makeUser(), subscription: makeSub({ status: 'trialing' }) };
    expect(isPro(user)).toBe(true);
  });

  it('returns false when subscription is null', () => {
    const user = { ...makeUser(), subscription: null };
    expect(isPro(user)).toBe(false);
  });

  it('returns false when subscription is undefined', () => {
    const user = { ...makeUser() };
    expect(isPro(user)).toBe(false);
  });

  it('returns false for canceled subscription', () => {
    const user = { ...makeUser(), subscription: makeSub({ status: 'canceled' }) };
    expect(isPro(user)).toBe(false);
  });

  it('returns false for past_due subscription', () => {
    const user = { ...makeUser(), subscription: makeSub({ status: 'past_due' }) };
    expect(isPro(user)).toBe(false);
  });

  it('returns false for active subscription with expired period end', () => {
    const pastDate = new Date(Date.now() - 1000); // 1 second ago
    const user = {
      ...makeUser(),
      subscription: makeSub({ status: 'active', currentPeriodEnd: pastDate }),
    };
    expect(isPro(user)).toBe(false);
  });

  it('returns false for trialing subscription with expired period end', () => {
    const pastDate = new Date(Date.now() - 1000);
    const user = {
      ...makeUser(),
      subscription: makeSub({ status: 'trialing', currentPeriodEnd: pastDate }),
    };
    expect(isPro(user)).toBe(false);
  });
});
