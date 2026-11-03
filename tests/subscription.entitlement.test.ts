import { afterEach, describe, expect, it, vi } from "vitest";
import { Role, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    subscription: { findUnique: vi.fn() },
  },
}));

vi.mock("@/infrastructure/prisma", () => ({
  prisma: prismaMock,
  onNotificationsCreated: vi.fn(),
}));

import { requireEntitlement } from "@/middleware/requireEntitlement";
import { AppError } from "@/shared/errors/AppError";

const DAY = 86_400_000;

const runGate = async (user: { id: string; role: Role } | undefined, sub?: unknown) => {
  prismaMock.subscription.findUnique.mockResolvedValue(sub ?? null);
  const req = { user } as never;
  const next = vi.fn();
  await requireEntitlement(req, {} as never, next);
  return next;
};

const baseSub = (overrides: Record<string, unknown>) => ({
  id: "s1",
  userId: "u1",
  plan: SubscriptionPlan.MONTHLY,
  status: SubscriptionStatus.ACTIVE,
  amount: 1999,
  billingCycle: "Monthly",
  startDate: new Date(Date.now() - DAY),
  renewalDate: new Date(Date.now() + 10 * DAY),
  nextPayment: null,
  paymentMethod: "Stripe",
  trialDaysLeft: 0,
  trialDaysTotal: 90,
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  stripePriceId: "price_1",
  stripeCheckoutSessionId: null,
  checkoutSessionExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

afterEach(() => vi.clearAllMocks());

describe("requireEntitlement", () => {
  it("rejects unauthenticated requests", async () => {
    const next = await runGate(undefined);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  it("lets ADMIN through without reading a subscription", async () => {
    const next = await runGate({ id: "a1", role: Role.ADMIN });
    expect(next).toHaveBeenCalledWith();
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("lets SUPPLIER through without reading a subscription", async () => {
    const next = await runGate({ id: "sup1", role: Role.SUPPLIER });
    expect(next).toHaveBeenCalledWith();
    expect(prismaMock.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("allows a USER on an unexpired trial", async () => {
    const next = await runGate(
      { id: "u1", role: Role.USER },
      baseSub({
        status: SubscriptionStatus.TRIAL,
        plan: SubscriptionPlan.FREE,
        startDate: new Date(Date.now() - 5 * DAY),
        stripeSubscriptionId: null,
      }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("allows a USER with an ACTIVE paid plan", async () => {
    const next = await runGate(
      { id: "u1", role: Role.USER },
      baseSub({ status: SubscriptionStatus.ACTIVE }),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks a USER whose trial has expired", async () => {
    const next = await runGate(
      { id: "u1", role: Role.USER },
      baseSub({
        status: SubscriptionStatus.TRIAL,
        plan: SubscriptionPlan.FREE,
        startDate: new Date(Date.now() - 200 * DAY),
        stripeSubscriptionId: null,
      }),
    );
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.details).toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
  });

  it("blocks a USER who is PAST_DUE", async () => {
    const next = await runGate(
      { id: "u1", role: Role.USER },
      baseSub({ status: SubscriptionStatus.PAST_DUE }),
    );
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  it("blocks a USER with no subscription row", async () => {
    const next = await runGate({ id: "u1", role: Role.USER }, null);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });
});
