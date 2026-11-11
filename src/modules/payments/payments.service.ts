import { PaymentKind, PaymentStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { logger } from "@/config/logger";
import { NotFoundError } from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import {
  getStripe,
  isPaymentConfigured,
} from "@/modules/user/subscriptions/stripeClient";
import { serializePayment } from "./payments.mapper";
import { syncAllPayments, syncUserPayments } from "./payments.sync";
import type { AdminPaymentsQuery, MyPaymentsQuery } from "./payments.validators";

const memberInclude = {
  advertisement: { select: { id: true, title: true } },
} satisfies Prisma.PaymentInclude;

const adminInclude = {
  ...memberInclude,
  user: {
    select: {
      id: true,
      email: true,
      role: true,
      profile: { select: { firstName: true, lastName: true, company: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

const toKind = (kind?: string) =>
  kind ? (kind.toUpperCase() as PaymentKind) : undefined;
const toStatus = (status?: string) =>
  status ? (status.toUpperCase() as PaymentStatus) : undefined;

function adminWhere(query: AdminPaymentsQuery): Prisma.PaymentWhereInput {
  const search = query.search;
  return {
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.kind ? { kind: toKind(query.kind) } : {}),
    ...(query.status ? { status: toStatus(query.status) } : {}),
    ...(search
      ? {
          OR: [
            { invoiceNumber: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            {
              user: {
                profile: {
                  OR: [
                    { firstName: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                    { company: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
}

/** Paid totals (EUR, major units) for the rows matching the admin filters. */
async function paidSummary(where: Prisma.PaymentWhereInput) {
  const groups = await prisma.payment.groupBy({
    by: ["kind"],
    where: { ...where, status: PaymentStatus.PAID, currency: "eur" },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const byKind = (kind: PaymentKind) =>
    (groups.find((g) => g.kind === kind)?._sum.amount ?? 0) / 100;

  return {
    currency: "EUR",
    paidTotal: groups.reduce((sum, g) => sum + (g._sum.amount ?? 0), 0) / 100,
    paidCount: groups.reduce((sum, g) => sum + g._count._all, 0),
    subscriptionTotal: byKind(PaymentKind.SUBSCRIPTION),
    advertisementTotal: byKind(PaymentKind.ADVERTISEMENT),
  };
}

export const paymentsService = {
  /** The signed-in member's own history, refreshed from Stripe first. */
  async listMine(userId: string, query: MyPaymentsQuery) {
    await syncUserPayments(userId);

    const where: Prisma.PaymentWhereInput = {
      userId,
      ...(query.kind ? { kind: toKind(query.kind) } : {}),
    };
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const [rows, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        include: memberInclude,
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      data: rows.map(serializePayment),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Every member's payments, with filters and paid totals. */
  async listAll(query: AdminPaymentsQuery) {
    // One member's history (user detail page) is refreshed like their own view.
    if (query.userId) await syncUserPayments(query.userId);

    const where = adminWhere(query);
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    const [rows, total, summary] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: adminInclude,
        orderBy: [{ issuedAt: query.sort }, { id: query.sort }],
        skip,
        take,
      }),
      prisma.payment.count({ where }),
      paidSummary(where),
    ]);

    return {
      data: rows.map(serializePayment),
      meta: {
        ...buildPaginationMeta(query.page, query.pageSize, total),
        summary,
      },
    };
  },

  /**
   * Current invoice / receipt links for one payment. Links are re-read from
   * Stripe on demand because Stripe-hosted invoice links can expire.
   * Members only see their own payments; admins see all.
   */
  async getLinks(paymentId: string, requester: { id: string; role: Role }) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (
      !payment ||
      (requester.role !== Role.ADMIN && payment.userId !== requester.id)
    ) {
      throw new NotFoundError("Payment not found");
    }

    let { hostedInvoiceUrl, invoicePdfUrl } = payment;

    if (payment.stripeInvoiceId && isPaymentConfigured()) {
      try {
        const invoice = await getStripe().invoices.retrieve(payment.stripeInvoiceId);
        hostedInvoiceUrl = invoice.hosted_invoice_url ?? hostedInvoiceUrl;
        invoicePdfUrl = invoice.invoice_pdf ?? invoicePdfUrl;
        if (
          hostedInvoiceUrl !== payment.hostedInvoiceUrl ||
          invoicePdfUrl !== payment.invoicePdfUrl
        ) {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { hostedInvoiceUrl, invoicePdfUrl },
          });
        }
      } catch (err) {
        logger.warn(
          { paymentId, invoiceId: payment.stripeInvoiceId, err },
          "Could not refresh invoice links from Stripe; using stored links",
        );
      }
    }

    return {
      invoiceNumber: payment.invoiceNumber,
      hostedInvoiceUrl,
      invoicePdfUrl,
      receiptUrl: payment.receiptUrl,
    };
  },

  syncAll: syncAllPayments,
};
