import { afterEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const { prismaMock, stripeMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    advertisement: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    subscription: { findFirst: vi.fn(), findUnique: vi.fn() },
    payment: { upsert: vi.fn(async (args) => ({ id: "p1", ...args.create })), update: vi.fn() },
  },
  stripeMock: {
    invoices: { retrieve: vi.fn(), list: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    checkout: { sessions: { retrieve: vi.fn() } },
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/user/subscriptions/stripeClient", () => ({
  getStripe: () => stripeMock,
  isPaymentConfigured: () => true,
}));

import {
  recordAdCheckoutSession,
  resetPaymentSyncThrottle,
  syncUserPayments,
  upsertPaymentFromInvoice,
} from "@/modules/payments/payments.sync";

afterEach(() => {
  vi.clearAllMocks();
  resetPaymentSyncThrottle();
});

const paidInvoice = (overrides: Partial<Stripe.Invoice> = {}) =>
  ({
    id: "in_1",
    status: "paid",
    attempted: true,
    amount_paid: 2500,
    amount_due: 2500,
    currency: "eur",
    description: "Sponsored advertisement — 7 days",
    number: "N-1",
    customer: "cus_1",
    created: 1_700_000_000,
    metadata: { kind: "ad", adId: "ad1", userId: "u1" },
    parent: null,
    billing_reason: "manual",
    status_transitions: { finalized_at: 1_700_000_000, paid_at: 1_700_000_000 },
    lines: { data: [] },
    ...overrides,
  }) as unknown as Stripe.Invoice;

describe("upsertPaymentFromInvoice", () => {
  it("records an ad invoice for the member and ad named in its metadata", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.advertisement.findUnique.mockResolvedValue({ id: "ad1" });

    await upsertPaymentFromInvoice(paidInvoice());

    const args = prismaMock.payment.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ stripeInvoiceId: "in_1" });
    expect(args.create).toMatchObject({
      userId: "u1",
      advertisementId: "ad1",
      kind: "ADVERTISEMENT",
      status: "PAID",
      amount: 2500,
    });
  });

  it("falls back to the member holding the Stripe customer", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findFirst.mockResolvedValue({ userId: "u2" });

    await upsertPaymentFromInvoice(paidInvoice({ metadata: {} }));

    expect(prismaMock.subscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeCustomerId: "cus_1" } }),
    );
    expect(prismaMock.payment.upsert.mock.calls[0][0].create.userId).toBe("u2");
  });

  it("skips drafts and invoices with no matching member", async () => {
    expect(await upsertPaymentFromInvoice(paidInvoice({ status: "draft" }))).toBeNull();

    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.subscription.findFirst.mockResolvedValue(null);
    expect(await upsertPaymentFromInvoice(paidInvoice({ metadata: {} }))).toBeNull();

    expect(prismaMock.payment.upsert).not.toHaveBeenCalled();
  });
});

describe("recordAdCheckoutSession", () => {
  const session = (overrides: Partial<Stripe.Checkout.Session> = {}) =>
    ({
      id: "cs_1",
      mode: "payment",
      payment_status: "paid",
      metadata: { kind: "ad", adId: "ad1", userId: "u1" },
      invoice: null,
      payment_intent: "pi_1",
      amount_total: 2500,
      currency: "eur",
      customer: null,
      created: 1_700_000_000,
      ...overrides,
    }) as unknown as Stripe.Checkout.Session;

  it("records the session's invoice when Stripe issued one", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.advertisement.findUnique.mockResolvedValue({ id: "ad1" });
    stripeMock.invoices.retrieve.mockResolvedValue(paidInvoice());

    await recordAdCheckoutSession(session({ invoice: "in_1" }));

    expect(stripeMock.invoices.retrieve).toHaveBeenCalledWith("in_1");
    const args = prismaMock.payment.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ stripeInvoiceId: "in_1" });
    expect(args.create.stripeCheckoutSessionId).toBe("cs_1");
  });

  it("stores an invoiceless (older) payment with its card receipt", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    prismaMock.advertisement.findUnique.mockResolvedValue({
      id: "ad1",
      title: "Promo",
      durationDays: 14,
      paidAt: null,
    });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: { receipt_url: "https://pay.stripe.com/receipts/1", created: 1_700_000_500 },
    });

    await recordAdCheckoutSession(session());

    const args = prismaMock.payment.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ stripeCheckoutSessionId: "cs_1" });
    expect(args.create).toMatchObject({
      userId: "u1",
      kind: "ADVERTISEMENT",
      status: "PAID",
      amount: 2500,
      receiptUrl: "https://pay.stripe.com/receipts/1",
      description: "Sponsored advertisement — 14 days",
      advertisementId: "ad1",
    });
  });

  it("ignores unpaid and non-ad sessions", async () => {
    expect(await recordAdCheckoutSession(session({ payment_status: "unpaid" }))).toBeNull();
    expect(await recordAdCheckoutSession(session({ mode: "subscription" }))).toBeNull();
    expect(prismaMock.payment.upsert).not.toHaveBeenCalled();
  });
});

describe("syncUserPayments", () => {
  it("reads the member's Stripe invoices at most once per minute", async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ stripeCustomerId: "cus_1" });
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1" });
    stripeMock.invoices.list.mockReturnValue({
      autoPagingToArray: vi.fn(async () => [paidInvoice()]),
    });

    await syncUserPayments("u1");
    await syncUserPayments("u1");

    expect(stripeMock.invoices.list).toHaveBeenCalledTimes(1);
    expect(stripeMock.invoices.list).toHaveBeenCalledWith({ customer: "cus_1", limit: 100 });
    expect(prismaMock.payment.upsert).toHaveBeenCalledTimes(1);
  });

  it("never throws when Stripe fails, and retries on the next visit", async () => {
    prismaMock.subscription.findUnique.mockResolvedValue({ stripeCustomerId: "cus_1" });
    stripeMock.invoices.list.mockReturnValue({
      autoPagingToArray: vi.fn(async () => {
        throw new Error("Stripe down");
      }),
    });

    await expect(syncUserPayments("u1")).resolves.toBeUndefined();
    await syncUserPayments("u1");
    expect(stripeMock.invoices.list).toHaveBeenCalledTimes(2);
  });
});
