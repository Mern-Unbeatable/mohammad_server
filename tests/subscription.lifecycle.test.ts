import { describe, expect, it } from "vitest";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import {
  addBillingPeriod,
  computeTrialDaysLeft,
  deriveSubscriptionState,
} from "@/modules/user/subscriptions/subscriptionLifecycle";

const DAY = 86_400_000;

/** Minimal Subscription row for the pure lifecycle helpers. */
const makeSub = (
  overrides: Partial<Record<string, unknown>> = {},
): Parameters<typeof deriveSubscriptionState>[0] =>
  ({
    id: "sub-1",
    userId: "user-1",
    plan: SubscriptionPlan.FREE,
    status: SubscriptionStatus.TRIAL,
    amount: 0,
    billingCycle: null,
    startDate: new Date(),
    renewalDate: null,
    nextPayment: null,
    paymentMethod: null,
    trialDaysLeft: 90,
    trialDaysTotal: 90,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
    stripeCheckoutSessionId: null,
    checkoutSessionExpiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Parameters<typeof deriveSubscriptionState>[0];

describe("deriveSubscriptionState", () => {
  it("keeps an unexpired trial active with remaining days", () => {
    const sub = makeSub({
      status: SubscriptionStatus.TRIAL,
      startDate: new Date(Date.now() - 10 * DAY),
      trialDaysTotal: 90,
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.TRIAL);
    expect(state.isActive).toBe(true);
    expect(state.trialDaysLeft).toBeGreaterThan(0);
  });

  it("expires a trial whose days have run out", () => {
    const sub = makeSub({
      status: SubscriptionStatus.TRIAL,
      startDate: new Date(Date.now() - 120 * DAY),
      trialDaysTotal: 90,
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.EXPIRED);
    expect(state.isActive).toBe(false);
    expect(state.trialDaysLeft).toBe(0);
  });

  it("treats PAST_DUE as not entitled (restricted premium access)", () => {
    const sub = makeSub({
      status: SubscriptionStatus.PAST_DUE,
      plan: SubscriptionPlan.MONTHLY,
      stripeSubscriptionId: "sub_123",
      renewalDate: new Date(Date.now() - 2 * DAY),
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(state.isActive).toBe(false);
  });

  it("keeps a Stripe-managed ACTIVE plan active even past the stored renewal date", () => {
    const sub = makeSub({
      status: SubscriptionStatus.ACTIVE,
      plan: SubscriptionPlan.MONTHLY,
      stripeSubscriptionId: "sub_123",
      renewalDate: new Date(Date.now() - 1 * DAY),
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.ACTIVE);
    expect(state.isActive).toBe(true);
  });

  it("expires a local (non-Stripe) ACTIVE plan once its period ends", () => {
    const sub = makeSub({
      status: SubscriptionStatus.ACTIVE,
      plan: SubscriptionPlan.MONTHLY,
      stripeSubscriptionId: null,
      renewalDate: new Date(Date.now() - 1 * DAY),
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.EXPIRED);
    expect(state.isActive).toBe(false);
  });

  it("keeps a cancelled plan active until the prepaid period ends", () => {
    const sub = makeSub({
      status: SubscriptionStatus.CANCELLED,
      plan: SubscriptionPlan.MONTHLY,
      renewalDate: new Date(Date.now() + 10 * DAY),
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.CANCELLED);
    expect(state.isActive).toBe(true);
    expect(state.cancelAtPeriodEnd).toBe(true);
  });

  it("expires a cancelled plan after the prepaid period ends", () => {
    const sub = makeSub({
      status: SubscriptionStatus.CANCELLED,
      plan: SubscriptionPlan.MONTHLY,
      renewalDate: new Date(Date.now() - 1 * DAY),
    });
    const state = deriveSubscriptionState(sub);
    expect(state.status).toBe(SubscriptionStatus.EXPIRED);
    expect(state.isActive).toBe(false);
  });
});

describe("computeTrialDaysLeft", () => {
  it("is zero for non-trial subscriptions", () => {
    expect(
      computeTrialDaysLeft(makeSub({ status: SubscriptionStatus.ACTIVE })),
    ).toBe(0);
  });

  it("counts remaining whole days for a trial", () => {
    const sub = makeSub({
      status: SubscriptionStatus.TRIAL,
      startDate: new Date(Date.now() - 80 * DAY),
      trialDaysTotal: 90,
    });
    expect(computeTrialDaysLeft(sub)).toBeGreaterThanOrEqual(9);
    expect(computeTrialDaysLeft(sub)).toBeLessThanOrEqual(10);
  });
});

describe("addBillingPeriod", () => {
  it("advances a month for the monthly plan", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const next = addBillingPeriod(from, SubscriptionPlan.MONTHLY);
    expect(next.getUTCMonth()).toBe(1);
  });

  it("advances a year for the yearly plan", () => {
    const from = new Date("2026-01-15T00:00:00Z");
    const next = addBillingPeriod(from, SubscriptionPlan.YEARLY);
    expect(next.getUTCFullYear()).toBe(2027);
  });
});
