import type Stripe from "stripe";
import { AdPaymentStatus, PaymentKind, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { logger } from "@/config/logger";
import {
  getStripe,
  isPaymentConfigured,
} from "@/modules/user/subscriptions/stripeClient";
import {
  customerIdOf,
  invoiceToPaymentFields,
  unixToDate,
  userIdFromInvoiceMetadata,
} from "./payments.mapper";

/**
 * Keeps the Payment ledger in step with Stripe. Webhooks write rows as
 * invoices change; `syncUserPayments` backfills anything a webhook missed
 * (and payments made before this ledger existed) when a member opens their
 * history; `syncAllPayments` does the same for every account (admin action).
 */

/** Opening a history page re-reads Stripe at most once a minute per member. */
const SYNC_THROTTLE_MS = 60_000;
const lastUserSync = new Map<string, number>();

/** Hard cap on invoices read per member sync. */
const MAX_INVOICES_PER_USER = 300;

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  !ref ? null : typeof ref === "string" ? ref : ref.id;

async function existingUserId(userId: string | null | undefined) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function existingAdId(adId: string | null | undefined) {
  if (!adId) return null;
  const ad = await prisma.advertisement.findUnique({
    where: { id: adId },
    select: { id: true },
  });
  return ad?.id ?? null;
}

/** Owner of an invoice: Stripe metadata first, then the member holding that Stripe customer. */
async function resolveInvoiceUser(invoice: Stripe.Invoice, hint?: string) {
  const fromMeta = await existingUserId(hint ?? userIdFromInvoiceMetadata(invoice));
  if (fromMeta) return fromMeta;

  const customerId = customerIdOf(invoice.customer);
  if (!customerId) return null;
  const subscription = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
  });
  return subscription?.userId ?? null;
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Upsert that tolerates a concurrent writer creating the same row first. */
async function upsertPayment(
  where: Prisma.PaymentWhereUniqueInput,
  data: Prisma.PaymentUncheckedCreateInput,
) {
  try {
    return await prisma.payment.upsert({ where, create: data, update: data });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.payment.update({ where, data });
  }
}

/**
 * Record one Stripe invoice. Drafts and invoices that cannot be tied to a
 * member are skipped (returns `null`).
 */
export async function upsertPaymentFromInvoice(
  invoice: Stripe.Invoice,
  options: { userId?: string; checkoutSessionId?: string } = {},
) {
  const fields = invoiceToPaymentFields(invoice);
  if (!fields) return null;

  const userId = await resolveInvoiceUser(invoice, options.userId);
  if (!userId) {
    logger.warn(
      { invoiceId: invoice.id, customer: fields.stripeCustomerId },
      "Stripe invoice has no matching member — not recorded",
    );
    return null;
  }

  const advertisementId =
    fields.kind === PaymentKind.ADVERTISEMENT
      ? await existingAdId(invoice.metadata?.adId)
      : null;

  return upsertPayment(
    { stripeInvoiceId: invoice.id },
    {
      ...fields,
      userId,
      advertisementId,
      ...(options.checkoutSessionId
        ? { stripeCheckoutSessionId: options.checkoutSessionId }
        : {}),
    },
  );
}

/** Re-read an invoice from Stripe (never trust webhook ordering) and record it. */
export async function recordInvoiceById(
  invoiceRef: string | { id: string } | null | undefined,
  options: { userId?: string; checkoutSessionId?: string } = {},
) {
  const invoiceId = idOf(invoiceRef);
  if (!invoiceId) return null;
  const invoice = await getStripe().invoices.retrieve(invoiceId);
  return upsertPaymentFromInvoice(invoice, options);
}

/**
 * Record a paid advertising-fee Checkout session. New sessions carry an
 * invoice; sessions paid before invoices were enabled are stored with the
 * card receipt instead.
 */
export async function recordAdCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment" || session.metadata?.kind !== "ad") return null;
  if (session.payment_status !== "paid") return null;

  const userId = session.metadata?.userId;

  if (session.invoice) {
    return recordInvoiceById(session.invoice, {
      userId,
      checkoutSessionId: session.id,
    });
  }

  const ownerId = await existingUserId(userId);
  if (!ownerId) return null;

  const stripe = getStripe();
  let receiptUrl: string | null = null;
  let paidAt: Date | null = null;
  const paymentIntentId = idOf(session.payment_intent);
  if (paymentIntentId) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = intent.latest_charge;
    if (charge && typeof charge !== "string") {
      receiptUrl = charge.receipt_url ?? null;
      paidAt = unixToDate(charge.created);
    }
  }

  const ad = session.metadata?.adId
    ? await prisma.advertisement.findUnique({
        where: { id: session.metadata.adId },
        select: { id: true, title: true, durationDays: true, paidAt: true },
      })
    : null;

  const issuedAt = unixToDate(session.created) ?? new Date();

  return upsertPayment(
    { stripeCheckoutSessionId: session.id },
    {
      userId: ownerId,
      kind: PaymentKind.ADVERTISEMENT,
      status: PaymentStatus.PAID,
      amount: session.amount_total ?? 0,
      currency: session.currency || "eur",
      description: ad
        ? `Sponsored advertisement — ${ad.durationDays} days`
        : "Sponsored advertisement",
      stripeCheckoutSessionId: session.id,
      stripeCustomerId: customerIdOf(session.customer),
      receiptUrl,
      advertisementId: ad?.id ?? null,
      paidAt: paidAt ?? ad?.paidAt ?? issuedAt,
      issuedAt,
    },
  );
}

/** Paid ads whose payment is not in the ledger yet (paid before it existed, or a missed webhook). */
async function backfillAdPayments(where: Prisma.AdvertisementWhereInput) {
  const ads = await prisma.advertisement.findMany({
    where: {
      ...where,
      paymentStatus: AdPaymentStatus.PAID,
      stripeCheckoutSessionId: { not: null },
      payments: { none: {} },
    },
    select: { id: true, stripeCheckoutSessionId: true },
  });

  const stripe = getStripe();
  let recorded = 0;
  for (const ad of ads) {
    try {
      const session = await stripe.checkout.sessions.retrieve(
        ad.stripeCheckoutSessionId!,
      );
      if (await recordAdCheckoutSession(session)) recorded += 1;
    } catch (err) {
      logger.warn(
        { adId: ad.id, sessionId: ad.stripeCheckoutSessionId, err },
        "Could not backfill advertisement payment",
      );
    }
  }
  return recorded;
}

/**
 * Bring one member's ledger up to date with Stripe. Throttled unless
 * `force` is set; never throws, so a Stripe outage only means slightly stale
 * history rather than a broken page.
 */
export async function syncUserPayments(userId: string, { force = false } = {}) {
  if (!isPaymentConfigured()) return;

  const now = Date.now();
  if (!force && now - (lastUserSync.get(userId) ?? 0) < SYNC_THROTTLE_MS) return;
  lastUserSync.set(userId, now);

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { stripeCustomerId: true },
    });

    if (subscription?.stripeCustomerId) {
      const invoices = await getStripe()
        .invoices.list({ customer: subscription.stripeCustomerId, limit: 100 })
        .autoPagingToArray({ limit: MAX_INVOICES_PER_USER });
      for (const invoice of invoices) {
        await upsertPaymentFromInvoice(invoice, { userId });
      }
    }

    await backfillAdPayments({ supplierId: userId });
  } catch (err) {
    // Allow a retry on the next visit instead of waiting out the throttle.
    lastUserSync.delete(userId);
    logger.warn({ userId, err }, "Payment history sync from Stripe failed");
  }
}

/** Admin backfill: every Stripe invoice plus every paid ad missing from the ledger. */
export async function syncAllPayments() {
  if (!isPaymentConfigured()) {
    return { invoicesScanned: 0, invoicesRecorded: 0, adPaymentsRecorded: 0 };
  }

  let invoicesScanned = 0;
  let invoicesRecorded = 0;
  for await (const invoice of getStripe().invoices.list({ limit: 100 })) {
    invoicesScanned += 1;
    try {
      if (await upsertPaymentFromInvoice(invoice)) invoicesRecorded += 1;
    } catch (err) {
      logger.warn({ invoiceId: invoice.id, err }, "Could not record Stripe invoice");
    }
  }

  const adPaymentsRecorded = await backfillAdPayments({});
  lastUserSync.clear();

  return { invoicesScanned, invoicesRecorded, adPaymentsRecorded };
}

/** Test hook: forget throttle state. */
export function resetPaymentSyncThrottle() {
  lastUserSync.clear();
}
