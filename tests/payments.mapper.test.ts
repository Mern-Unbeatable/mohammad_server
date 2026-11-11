import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  invoiceToPaymentFields,
  paymentKindFromInvoice,
  paymentStatusFromInvoice,
  serializePayment,
  userIdFromInvoiceMetadata,
} from "@/modules/payments/payments.mapper";

const invoice = (overrides: Partial<Stripe.Invoice> = {}) =>
  ({
    id: "in_1",
    status: "paid",
    attempted: true,
    amount_paid: 999,
    amount_due: 999,
    currency: "eur",
    description: null,
    number: "ABC-0001",
    customer: "cus_1",
    hosted_invoice_url: "https://invoice.stripe.com/i/1",
    invoice_pdf: "https://pay.stripe.com/invoice/1/pdf",
    created: 1_700_000_000,
    metadata: {},
    billing_reason: "subscription_create",
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { metadata: { userId: "u_sub" }, subscription: "sub_1" },
    },
    status_transitions: {
      finalized_at: 1_700_000_100,
      paid_at: 1_700_000_200,
      marked_uncollectible_at: null,
      voided_at: null,
    },
    lines: {
      data: [
        {
          description: "1 × Membership (at €9.99 / month)",
          period: { start: 1_700_000_000, end: 1_702_592_000 },
        },
      ],
    },
    ...overrides,
  }) as unknown as Stripe.Invoice;

describe("paymentStatusFromInvoice", () => {
  it("maps Stripe statuses and skips drafts", () => {
    expect(paymentStatusFromInvoice(invoice({ status: "paid" }))).toBe("PAID");
    expect(paymentStatusFromInvoice(invoice({ status: "void" }))).toBe("VOID");
    expect(paymentStatusFromInvoice(invoice({ status: "uncollectible" }))).toBe(
      "UNCOLLECTIBLE",
    );
    expect(paymentStatusFromInvoice(invoice({ status: "draft" }))).toBeNull();
  });

  it("treats an open invoice Stripe already tried to charge as failed", () => {
    expect(paymentStatusFromInvoice(invoice({ status: "open", attempted: false }))).toBe("OPEN");
    expect(paymentStatusFromInvoice(invoice({ status: "open", attempted: true }))).toBe("FAILED");
  });
});

describe("paymentKindFromInvoice", () => {
  it("detects ad fees, subscriptions and dashboard invoices", () => {
    expect(paymentKindFromInvoice(invoice({ metadata: { kind: "ad" } }))).toBe("ADVERTISEMENT");
    expect(paymentKindFromInvoice(invoice())).toBe("SUBSCRIPTION");
    expect(
      paymentKindFromInvoice(invoice({ parent: null, billing_reason: "manual" })),
    ).toBe("OTHER");
  });
});

describe("userIdFromInvoiceMetadata", () => {
  it("prefers invoice metadata, then the subscription snapshot", () => {
    expect(userIdFromInvoiceMetadata(invoice({ metadata: { userId: "u_ad" } }))).toBe("u_ad");
    expect(userIdFromInvoiceMetadata(invoice())).toBe("u_sub");
    expect(userIdFromInvoiceMetadata(invoice({ parent: null }))).toBeNull();
  });
});

describe("invoiceToPaymentFields", () => {
  it("records the amount paid, links and the line's service period", () => {
    const fields = invoiceToPaymentFields(invoice())!;
    expect(fields).toMatchObject({
      kind: "SUBSCRIPTION",
      status: "PAID",
      amount: 999,
      currency: "eur",
      description: "1 × Membership (at €9.99 / month)",
      invoiceNumber: "ABC-0001",
      stripeInvoiceId: "in_1",
      stripeCustomerId: "cus_1",
      invoicePdfUrl: "https://pay.stripe.com/invoice/1/pdf",
    });
    expect(fields.issuedAt).toEqual(new Date(1_700_000_100_000));
    expect(fields.paidAt).toEqual(new Date(1_700_000_200_000));
    expect(fields.periodEnd).toEqual(new Date(1_702_592_000_000));
  });

  it("records a 100% coupon invoice as a paid €0 payment", () => {
    const fields = invoiceToPaymentFields(invoice({ amount_paid: 0, amount_due: 0 }))!;
    expect(fields.status).toBe("PAID");
    expect(fields.amount).toBe(0);
  });

  it("uses the amount still due while unpaid, and skips drafts", () => {
    expect(
      invoiceToPaymentFields(invoice({ status: "open", attempted: true, amount_paid: 0 }))!
        .amount,
    ).toBe(999);
    expect(invoiceToPaymentFields(invoice({ status: "draft" }))).toBeNull();
  });
});

describe("serializePayment", () => {
  const row = {
    id: "p1",
    userId: "u1",
    kind: "ADVERTISEMENT",
    status: "PAID",
    amount: 2500,
    currency: "eur",
    description: "Sponsored advertisement — 7 days",
    invoiceNumber: null,
    stripeInvoiceId: null,
    stripeCheckoutSessionId: "cs_1",
    stripeCustomerId: null,
    hostedInvoiceUrl: null,
    invoicePdfUrl: null,
    receiptUrl: "https://pay.stripe.com/receipts/1",
    advertisementId: "ad1",
    periodStart: null,
    periodEnd: null,
    paidAt: new Date(0),
    issuedAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  } as const;

  it("returns major units and hides raw Stripe links", () => {
    const out = serializePayment({
      ...row,
      advertisement: { id: "ad1", title: "Summer promo" },
    } as never);
    expect(out).toMatchObject({
      amount: 25,
      currency: "EUR",
      hasInvoice: false,
      hasReceipt: true,
      advertisement: { id: "ad1", title: "Summer promo" },
    });
    expect(out).not.toHaveProperty("receiptUrl");
    expect(out).not.toHaveProperty("user");
  });

  it("adds the member for admin listings", () => {
    const out = serializePayment({
      ...row,
      user: {
        id: "u1",
        email: "a@lab.be",
        role: "SUPPLIER",
        profile: { firstName: "Ana", lastName: "Lee", company: "LabCo" },
      },
    } as never);
    expect(out.user).toEqual({
      id: "u1",
      email: "a@lab.be",
      role: "SUPPLIER",
      name: "Ana Lee",
      company: "LabCo",
    });
  });
});
