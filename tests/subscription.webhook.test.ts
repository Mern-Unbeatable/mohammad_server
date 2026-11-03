import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_SECRET_KEY = "sk_test";
  process.env.STRIPE_PRICE_MONTHLY = "price_m";
  process.env.STRIPE_PRICE_YEARLY = "price_y";
});

const { prismaMock, stripeMock, event } = vi.hoisted(() => {
  const event = {
    id: "evt_1",
    type: "customer.updated", // unhandled → default no-op branch
    created: 1_700_000_000,
    data: { object: {} },
  };
  return {
    event,
    prismaMock: {
      stripeWebhookEvent: {
        findUnique: vi.fn(),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
    },
    stripeMock: {
      webhooks: { constructEvent: vi.fn(() => event) },
      subscriptions: { retrieve: vi.fn() },
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

const raw = Buffer.from("{}");

afterEach(() => vi.clearAllMocks());

beforeAll(() => {
  stripeMock.webhooks.constructEvent.mockReturnValue(event);
});

describe("handleStripeWebhook idempotency", () => {
  it("processes a new event once and records it PROCESSED", async () => {
    prismaMock.stripeWebhookEvent.findUnique.mockResolvedValue(null);

    const result = await subscriptionsService.handleStripeWebhook(raw, "sig");

    expect(result).toMatchObject({ received: true });
    expect(prismaMock.stripeWebhookEvent.create).toHaveBeenCalledTimes(1);
    const processed = prismaMock.stripeWebhookEvent.update.mock.calls.find(
      ([args]) => args.data?.processingStatus === "PROCESSED",
    );
    expect(processed).toBeTruthy();
  });

  it("acknowledges a duplicate event without reprocessing", async () => {
    prismaMock.stripeWebhookEvent.findUnique.mockResolvedValue({
      stripeEventId: "evt_1",
      processingStatus: "PROCESSED",
    });

    const result = await subscriptionsService.handleStripeWebhook(raw, "sig");

    expect(result).toMatchObject({ received: true, duplicate: true });
    expect(prismaMock.stripeWebhookEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.stripeWebhookEvent.update).not.toHaveBeenCalled();
  });

  it("treats a unique-constraint race on insert as a duplicate", async () => {
    prismaMock.stripeWebhookEvent.findUnique.mockResolvedValue(null);
    prismaMock.stripeWebhookEvent.create.mockRejectedValueOnce(
      new Error("Unique constraint failed"),
    );

    const result = await subscriptionsService.handleStripeWebhook(raw, "sig");

    expect(result).toMatchObject({ received: true, duplicate: true });
  });

  it("rejects a missing signature", async () => {
    await expect(
      subscriptionsService.handleStripeWebhook(raw, undefined),
    ).rejects.toThrow();
    expect(prismaMock.stripeWebhookEvent.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before touching the ledger", async () => {
    stripeMock.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error("bad signature");
    });

    await expect(
      subscriptionsService.handleStripeWebhook(raw, "sig"),
    ).rejects.toThrow();
    expect(prismaMock.stripeWebhookEvent.create).not.toHaveBeenCalled();
  });
});
