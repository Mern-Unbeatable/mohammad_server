import { afterEach, describe, expect, it, vi } from "vitest";

const { prismaMock, stripeMock } = vi.hoisted(() => ({
  prismaMock: {
    payment: { findUnique: vi.fn(), update: vi.fn() },
  },
  stripeMock: { invoices: { retrieve: vi.fn() } },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/user/subscriptions/stripeClient", () => ({
  getStripe: () => stripeMock,
  isPaymentConfigured: () => true,
}));

import { paymentsService } from "@/modules/payments/payments.service";

afterEach(() => vi.clearAllMocks());

const payment = {
  id: "p1",
  userId: "owner",
  invoiceNumber: "N-1",
  stripeInvoiceId: "in_1",
  hostedInvoiceUrl: "https://invoice.stripe.com/old",
  invoicePdfUrl: "https://pay.stripe.com/old.pdf",
  receiptUrl: null,
};

describe("paymentsService.getLinks", () => {
  it("returns fresh Stripe links to the owner and stores them", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(payment);
    stripeMock.invoices.retrieve.mockResolvedValue({
      hosted_invoice_url: "https://invoice.stripe.com/new",
      invoice_pdf: "https://pay.stripe.com/new.pdf",
    });

    const links = await paymentsService.getLinks("p1", { id: "owner", role: "USER" });

    expect(links).toEqual({
      invoiceNumber: "N-1",
      hostedInvoiceUrl: "https://invoice.stripe.com/new",
      invoicePdfUrl: "https://pay.stripe.com/new.pdf",
      receiptUrl: null,
    });
    expect(prismaMock.payment.update).toHaveBeenCalledTimes(1);
  });

  it("lets an admin open any member's invoice", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(payment);
    stripeMock.invoices.retrieve.mockResolvedValue({});

    await expect(
      paymentsService.getLinks("p1", { id: "admin", role: "ADMIN" }),
    ).resolves.toMatchObject({ invoicePdfUrl: "https://pay.stripe.com/old.pdf" });
  });

  it("hides other members' payments", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(payment);

    await expect(
      paymentsService.getLinks("p1", { id: "someone-else", role: "SUPPLIER" }),
    ).rejects.toThrow("Payment not found");
    expect(stripeMock.invoices.retrieve).not.toHaveBeenCalled();
  });

  it("falls back to stored links when Stripe is unreachable", async () => {
    prismaMock.payment.findUnique.mockResolvedValue(payment);
    stripeMock.invoices.retrieve.mockRejectedValue(new Error("timeout"));

    const links = await paymentsService.getLinks("p1", { id: "owner", role: "USER" });
    expect(links.hostedInvoiceUrl).toBe("https://invoice.stripe.com/old");
    expect(prismaMock.payment.update).not.toHaveBeenCalled();
  });
});
