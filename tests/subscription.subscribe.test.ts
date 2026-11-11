import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test";
  process.env.STRIPE_PRICE_MONTHLY = "price_m";
  process.env.STRIPE_PRICE_YEARLY = "price_y";
});

const DAY = 86_400_000;

const { prismaMock, stripeMock, state } = vi.hoisted(() => {
  const state = {
    row: {
      id: "s1",
      userId: "u1",
      plan: "FREE",
      status: "TRIAL",
      amount: 0,
      billingCycle: null,
      startDate: new Date(Date.now() - 5 * 86_400_000),
      renewalDate: null,
      nextPayment: null,
      paymentMethod: null,
      trialDaysLeft: 85,
      trialDaysTotal: 90,
      stripeCustomerId: "cus_stale",
      stripeSubscriptionId: null,
      stripePriceId: null,
      stripeCheckoutSessionId: null,
      checkoutSessionExpiresAt: null,
      createdAt: new Date(Date.now() - 5 * 86_400_000),
      updatedAt: new Date(),
    } as Record<string, unknown>,
  };
  return {
    state,
    prismaMock: {
      subscription: {
        findUnique: vi.fn(async () => state.row),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state.row, data);
          return state.row;
        }),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state.row, data);
          return { count: 1 };
        }),
      },
      user: {
        findUnique: vi.fn(async () => ({
          id: "u1",
          email: "u1@test.example",
          profile: { firstName: "A", lastName: "B" },
          subscription: state.row,
        })),
      },
    },
    stripeMock: {
      customers: {
        retrieve: vi.fn(async () => {
          throw new Error("No such customer: 'cus_stale'");
        }),
        create: vi.fn(async () => ({ id: "cus_new" })),
      },
      checkout: {
        sessions: {
          create: vi.fn(async () => ({
            id: "cs_1",
            url: "https://checkout.stripe.test/cs_1",
            status: "open",
          })),
          retrieve: vi.fn(),
        },
      },
    },
  };
});

vi.mock("@/infrastructure/prisma", () => ({
  prisma: prismaMock,
  onNotificationsCreated: vi.fn(),
}));

vi.mock("@/modules/user/subscriptions/stripeClient", () => ({
  getStripe: () => stripeMock,
  getStripePriceId: () => "price_m",
  isPaymentConfigured: () => true,
  planFromStripePriceId: () => null,
}));

import { subscriptionsService } from "@/modules/user/subscriptions/subscriptions.service";

afterEach(() => {
  vi.clearAllMocks();
  state.row.stripeCustomerId = "cus_stale";
  state.row.stripeCheckoutSessionId = null;
  state.row.checkoutSessionExpiresAt = null;
  state.row.status = SubscriptionStatus.TRIAL;
  state.row.startDate = new Date(Date.now() - 5 * DAY);
});

describe("subscribe() with a stale Stripe customer", () => {
  it("recreates the customer and still returns a Checkout URL", async () => {
    const result = await subscriptionsService.subscribe(
      "u1",
      SubscriptionPlan.MONTHLY,
    );

    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith("cus_stale");
    expect(stripeMock.customers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    expect(result.payment.checkoutUrl).toBe(
      "https://checkout.stripe.test/cs_1",
    );
    // New customer id must be persisted.
    expect(state.row.stripeCustomerId).toBe("cus_new");
  });
});
