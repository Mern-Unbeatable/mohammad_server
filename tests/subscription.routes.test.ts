import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Role, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { startTestApp, tokenFor } from "./helpers/httpApp";

const DAY = 86_400_000;

const { prismaMock, rows } = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    prismaMock: {
      subscription: {
        findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
          rows.get(where.userId) ?? null,
        ),
        update: vi.fn(async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
          const next = { ...(rows.get(where.userId) ?? {}), ...data };
          rows.set(where.userId, next);
          return next;
        }),
      },
    },
  };
});

vi.mock("@/infrastructure/prisma", () => ({
  prisma: prismaMock,
  onNotificationsCreated: vi.fn(),
}));

const baseRow = (userId: string, overrides: Record<string, unknown>) => ({
  id: `s-${userId}`,
  userId,
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
});

let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(() => app.close());
afterEach(() => {
  vi.clearAllMocks();
  rows.clear();
});

describe("subscription entitlement on routes", () => {
  it("blocks an expired-trial USER from a premium route", async () => {
    rows.set(
      "u-expired",
      baseRow("u-expired", {
        status: SubscriptionStatus.TRIAL,
        startDate: new Date(Date.now() - 200 * DAY),
      }),
    );

    const res = await app.request("GET", "/feed", {
      token: tokenFor("u-expired", Role.USER),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.details).toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
  });

  it("keeps the billing/status endpoint open to an expired USER", async () => {
    rows.set(
      "u-expired2",
      baseRow("u-expired2", {
        status: SubscriptionStatus.TRIAL,
        startDate: new Date(Date.now() - 200 * DAY),
      }),
    );

    const res = await app.request("GET", "/subscriptions/me", {
      token: tokenFor("u-expired2", Role.USER),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("EXPIRED");
    expect(body.data.isActive).toBe(false);
  });

  it("allows a trial USER into a premium route", async () => {
    rows.set(
      "u-trial",
      baseRow("u-trial", {
        status: SubscriptionStatus.TRIAL,
        startDate: new Date(Date.now() - 5 * DAY),
      }),
    );

    const res = await app.request("GET", "/feed", {
      token: tokenFor("u-trial", Role.USER),
    });

    // Past the entitlement gate: the feed controller runs (may 500 on the
    // mocked feed query, but never 403 for the subscription gate).
    expect(res.status).not.toBe(403);
  });
});
