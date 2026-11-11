import type Stripe from "stripe";
import { PaymentKind, PaymentStatus, type Payment } from "@prisma/client";

/**
 * Pure Stripe → payment-ledger mapping. No I/O, so it is unit-tested directly.
 */

export const unixToDate = (seconds: number | null | undefined): Date | null =>
  seconds ? new Date(seconds * 1000) : null;

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  !ref ? null : typeof ref === "string" ? ref : ref.id;

/** Ledger status for a Stripe invoice; `null` for drafts, which are never recorded. */
export function paymentStatusFromInvoice(
  invoice: Pick<Stripe.Invoice, "status" | "attempted">,
): PaymentStatus | null {
  switch (invoice.status) {
    case "paid":
      return PaymentStatus.PAID;
    case "void":
      return PaymentStatus.VOID;
    case "uncollectible":
      return PaymentStatus.UNCOLLECTIBLE;
    case "open":
      // An open invoice Stripe already tried to charge is a failed payment.
      return invoice.attempted ? PaymentStatus.FAILED : PaymentStatus.OPEN;
    default:
      return null;
  }
}

export function paymentKindFromInvoice(
  invoice: Pick<Stripe.Invoice, "metadata" | "parent" | "billing_reason">,
): PaymentKind {
  if (invoice.metadata?.kind === "ad") return PaymentKind.ADVERTISEMENT;
  if (
    invoice.parent?.type === "subscription_details" ||
    invoice.billing_reason?.startsWith("subscription")
  ) {
    return PaymentKind.SUBSCRIPTION;
  }
  return PaymentKind.OTHER;
}

/** The app user an invoice belongs to, when Stripe metadata names one. */
export function userIdFromInvoiceMetadata(
  invoice: Pick<Stripe.Invoice, "metadata" | "parent">,
): string | null {
  return (
    invoice.metadata?.userId ||
    invoice.parent?.subscription_details?.metadata?.userId ||
    null
  );
}

export const customerIdOf = (
  customer: Stripe.Invoice["customer"] | Stripe.Checkout.Session["customer"],
): string | null => idOf(customer as never);

export type InvoiceFields = {
  kind: PaymentKind;
  status: PaymentStatus;
  amount: number;
  currency: string;
  description: string | null;
  invoiceNumber: string | null;
  stripeInvoiceId: string;
  stripeCustomerId: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  issuedAt: Date;
};

/** Ledger columns for a non-draft invoice, or `null` for a draft. */
export function invoiceToPaymentFields(invoice: Stripe.Invoice): InvoiceFields | null {
  const status = paymentStatusFromInvoice(invoice);
  if (!status) return null;

  const line = invoice.lines?.data?.[0];
  const transitions = invoice.status_transitions;

  return {
    kind: paymentKindFromInvoice(invoice),
    status,
    // What the member was actually charged once paid (0 with a 100% coupon);
    // what they still owe otherwise.
    amount: status === PaymentStatus.PAID ? invoice.amount_paid : invoice.amount_due,
    currency: invoice.currency || "eur",
    description: invoice.description || line?.description || null,
    invoiceNumber: invoice.number ?? null,
    stripeInvoiceId: invoice.id,
    stripeCustomerId: customerIdOf(invoice.customer),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    // The line period is the service period; the invoice-level period of a
    // subscription invoice describes the previous cycle.
    periodStart: unixToDate(line?.period?.start ?? null),
    periodEnd: unixToDate(line?.period?.end ?? null),
    paidAt: unixToDate(transitions?.paid_at ?? null),
    issuedAt: unixToDate(transitions?.finalized_at ?? null) ?? unixToDate(invoice.created)!,
  };
}

type PaymentWithRelations = Payment & {
  advertisement?: { id: string; title: string } | null;
  user?: {
    id: string;
    email: string;
    role: string;
    profile?: { firstName: string; lastName: string; company: string | null } | null;
  } | null;
};

/** API shape. Amounts are in major units, like every other money field the API returns. */
export function serializePayment(payment: PaymentWithRelations) {
  const user = payment.user;
  const name = user?.profile
    ? `${user.profile.firstName} ${user.profile.lastName}`.trim()
    : "";

  return {
    id: payment.id,
    kind: payment.kind,
    status: payment.status,
    amount: payment.amount / 100,
    currency: payment.currency.toUpperCase(),
    description: payment.description,
    invoiceNumber: payment.invoiceNumber,
    issuedAt: payment.issuedAt,
    paidAt: payment.paidAt,
    periodStart: payment.periodStart,
    periodEnd: payment.periodEnd,
    hasInvoice: Boolean(payment.stripeInvoiceId),
    hasReceipt: Boolean(payment.receiptUrl),
    advertisement: payment.advertisement
      ? { id: payment.advertisement.id, title: payment.advertisement.title }
      : null,
    ...(user
      ? {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            name: name || user.email,
            company: user.profile?.company ?? null,
          },
        }
      : {}),
  };
}

export type SerializedPayment = ReturnType<typeof serializePayment>;
