import { AdPaymentStatus, AdStatus, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/infrastructure/prisma";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "@/shared/errors/AppError";
import { buildPaginationMeta } from "@/shared/http/apiResponse";
import { toPrismaPagination } from "@/shared/http/pagination";
import { serializeProfile } from "@/shared/serializers/user.serializer";
import { settingsService } from "@/modules/admin/settings/settings.service";
import {
  getStripe,
  isPaymentConfigured,
} from "@/modules/user/subscriptions/stripeClient";
import type { AdListQuery } from "./advertisements.validators";

const include = {
  supplier: { include: { profile: true } },
} satisfies Prisma.AdvertisementInclude;
type Payload = Prisma.AdvertisementGetPayload<{ include: typeof include }>;

/** How long a single in-flight Checkout reservation is reused before lapsing. */
const CHECKOUT_RESERVATION_MS = 30 * 60 * 1000;

const serialize = (ad: Payload) => ({
  id: ad.id,
  title: ad.title,
  category: ad.category,
  description: ad.description,
  imageUrl: ad.imageUrl,
  videoUrl: ad.videoUrl,
  price: ad.price === null ? null : ad.price / 100,
  fee: ad.feeAmount === null ? null : ad.feeAmount / 100,
  paymentStatus: ad.paymentStatus,
  paidAt: ad.paidAt,
  contact: ad.contact,
  location: ad.location,
  eventDate: ad.eventDate,
  eventTime: ad.eventTime,
  organizer: ad.organizer,
  durationDays: ad.durationDays,
  startDate: ad.startDate,
  expiryDate: ad.expiryDate,
  status: ad.status,
  rejectionReason: ad.rejectionReason,
  views: ad.views,
  clicks: ad.clicks,
  uploadDate: ad.createdAt,
  supplier: {
    id: ad.supplier.id,
    company: ad.supplier.profile?.company ?? null,
    ...(ad.supplier.profile ? serializeProfile(ad.supplier.profile) : {}),
  },
});

/** Content fields that, when changed on a reviewed ad, force re-moderation. */
const CONTENT_FIELDS = [
  "title",
  "category",
  "description",
  "imageUrl",
  "videoUrl",
  "price",
  "contact",
  "location",
  "eventDate",
  "eventTime",
  "organizer",
] as const;

/**
 * Flip ACTIVE ads whose paid window has elapsed to EXPIRED. Called
 * opportunistically on reads and on a timer so listings stay truthful without
 * relying solely on admin action.
 */
async function expireStaleAds() {
  try {
    await prisma.advertisement.updateMany({
      where: { status: AdStatus.ACTIVE, expiryDate: { lt: new Date() } },
      data: { status: AdStatus.EXPIRED },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to expire stale advertisements");
  }
}

// ── Engagement de-duplication ──────────────────────────────────────────────
// Lightweight in-memory guard: the same actor cannot inflate the same metric
// on the same ad more than once per window. Sufficient for a single-node
// deployment; a shared store would be needed when horizontally scaled.
const TRACK_WINDOW_MS = 30 * 60 * 1000;
const trackSeen = new Map<string, number>();

function trackAllowed(key: string): boolean {
  const now = Date.now();
  const last = trackSeen.get(key);
  if (last && now - last < TRACK_WINDOW_MS) return false;
  trackSeen.set(key, now);
  if (trackSeen.size > 10_000) {
    for (const [k, t] of trackSeen) {
      if (now - t > TRACK_WINDOW_MS) trackSeen.delete(k);
    }
  }
  return true;
}

async function loadOwned(userId: string, id: string) {
  const ad = await prisma.advertisement.findUnique({ where: { id } });
  if (!ad) throw new NotFoundError("Advertisement not found");
  if (ad.supplierId !== userId) {
    throw new ForbiddenError("You can only manage your own ads");
  }
  return ad;
}

async function markAdPaid(ad: { id: string; status: AdStatus }) {
  const data: Prisma.AdvertisementUpdateInput = {
    paymentStatus: AdPaymentStatus.PAID,
    paidAt: new Date(),
    checkoutSessionExpiresAt: null,
  };
  // Payment settled → advance the unpaid draft into the approval queue.
  if (ad.status === AdStatus.PENDING_PAYMENT) {
    data.status = AdStatus.PENDING;
  }
  return prisma.advertisement.update({
    where: { id: ad.id },
    data,
    include,
  });
}

export const advertisementsService = {
  async list(userId: string, role: string, query: AdListQuery) {
    await expireStaleAds();
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);

    // Suppliers only ever see their own ads; admins see everything.
    const scope: Prisma.AdvertisementWhereInput =
      role === "ADMIN" ? {} : { supplierId: userId };

    const where: Prisma.AdvertisementWhereInput = {
      ...scope,
      ...(query.mine ? { supplierId: userId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, total] = await prisma.$transaction([
      prisma.advertisement.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.advertisement.count({ where }),
    ]);

    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  /** Publicly visible active ads for display on the site. */
  async listActive(query: AdListQuery) {
    await expireStaleAds();
    const { skip, take } = toPrismaPagination(query.page, query.pageSize);
    const where: Prisma.AdvertisementWhereInput = {
      status: AdStatus.ACTIVE,
      // Never surface ads past their paid window, even if the sweep lagged.
      OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
      ...(query.category ? { category: query.category } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.advertisement.findMany({
        where,
        include,
        orderBy: { createdAt: query.sort },
        skip,
        take,
      }),
      prisma.advertisement.count({ where }),
    ]);
    return {
      data: rows.map(serialize),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  },

  async getById(userId: string, role: string, id: string) {
    const ad = await prisma.advertisement.findUnique({
      where: { id },
      include,
    });
    if (!ad) throw new NotFoundError("Advertisement not found");
    if (
      role !== "ADMIN" &&
      ad.supplierId !== userId &&
      ad.status !== AdStatus.ACTIVE
    ) {
      throw new ForbiddenError("You cannot view this advertisement");
    }
    return serialize(ad);
  },

  async create(
    supplierId: string,
    input: {
      price?: number;
      durationDays: number;
      title: string;
      description: string;
      [key: string]: unknown;
    },
  ) {
    const { price, durationDays, ...rest } = input;

    // Idempotency guard: an accidental double-submit (double click, retry,
    // refresh mid-request) must not create two draft ads. Reuse any identical
    // unpaid draft created by the same supplier in the last 60 seconds.
    const recent = await prisma.advertisement.findFirst({
      where: {
        supplierId,
        title: input.title,
        description: input.description,
        status: AdStatus.PENDING_PAYMENT,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
      include,
      orderBy: { createdAt: "desc" },
    });
    if (recent) return serialize(recent);

    // Server-authoritative advertising fee from the sponsored pricing tier.
    const { feeCents } = await settingsService.getSponsoredFeeCents(
      durationDays,
    );

    const ad = await prisma.advertisement.create({
      data: {
        ...(rest as Prisma.AdvertisementUncheckedCreateInput),
        title: input.title,
        description: input.description,
        supplierId,
        durationDays,
        price: price === undefined ? null : Math.round(price * 100),
        feeAmount: feeCents,
        paymentStatus: AdPaymentStatus.UNPAID,
        status: AdStatus.PENDING_PAYMENT,
      },
      include,
    });
    return serialize(ad);
  },

  async update(userId: string, id: string, input: Record<string, unknown>) {
    const ad = await loadOwned(userId, id);
    if (ad.status === AdStatus.CANCELLED) {
      throw new BadRequestError("A cancelled advertisement cannot be edited");
    }

    const data: Prisma.AdvertisementUpdateInput = { ...input };
    if (typeof input.price === "number")
      data.price = Math.round(input.price * 100);

    const durationChanged =
      typeof input.durationDays === "number" &&
      input.durationDays !== ad.durationDays;

    if (durationChanged) {
      // Changing the duration changes the advertising fee, so the ad must be
      // (re)paid before it can go live again.
      const { feeCents } = await settingsService.getSponsoredFeeCents(
        input.durationDays as number,
      );
      data.feeAmount = feeCents;
      data.paymentStatus = AdPaymentStatus.UNPAID;
      data.paidAt = null;
      data.status = AdStatus.PENDING_PAYMENT;
      data.rejectionReason = null;
      data.stripeCheckoutSessionId = null;
      data.checkoutSessionExpiresAt = null;
    } else {
      const contentChanged = CONTENT_FIELDS.some((field) => field in input);
      // Editing content on a reviewed ad sends it back through moderation.
      // Already-paid ads keep their paid status; unpaid drafts stay unpaid.
      if (
        contentChanged &&
        (ad.status === AdStatus.ACTIVE ||
          ad.status === AdStatus.EXPIRED ||
          ad.status === AdStatus.REJECTED)
      ) {
        data.status = AdStatus.PENDING;
        data.rejectionReason = null;
      }
    }

    const updated = await prisma.advertisement.update({
      where: { id },
      data,
      include,
    });
    return serialize(updated);
  },

  async remove(userId: string, role: string, id: string) {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundError("Advertisement not found");
    if (ad.supplierId !== userId && role !== "ADMIN") {
      throw new ForbiddenError("You can only delete your own ads");
    }
    await prisma.advertisement.delete({ where: { id } });
  },

  /** Supplier withdraws an ad from circulation / the review queue. */
  async cancel(userId: string, id: string) {
    const ad = await loadOwned(userId, id);
    if (ad.status === AdStatus.CANCELLED) {
      return serialize(
        await prisma.advertisement.findUniqueOrThrow({ where: { id }, include }),
      );
    }
    const updated = await prisma.advertisement.update({
      where: { id },
      data: { status: AdStatus.CANCELLED },
      include,
    });
    return serialize(updated);
  },

  // ── Payment (Stripe one-time Checkout) ────────────────────────────────────

  /**
   * Start a Stripe Checkout session for the advertising fee. The ad is never
   * advanced out of PENDING_PAYMENT until the webhook (or confirm) verifies the
   * payment succeeded. Reuses a still-valid in-flight session on retry.
   */
  async startCheckout(userId: string, id: string) {
    if (!isPaymentConfigured()) {
      throw new BadRequestError("Stripe payment is not configured");
    }
    const ad = await loadOwned(userId, id);

    if (ad.paymentStatus === AdPaymentStatus.PAID) {
      throw new BadRequestError("This advertisement is already paid");
    }
    if (ad.status === AdStatus.CANCELLED) {
      throw new BadRequestError("A cancelled advertisement cannot be paid");
    }

    const feeCents =
      ad.feeAmount ??
      (await settingsService.getSponsoredFeeCents(ad.durationDays)).feeCents;

    const stripe = getStripe();
    const now = new Date();

    // Reuse a still-open session so a retry doesn't create duplicate sessions.
    if (
      ad.stripeCheckoutSessionId &&
      ad.checkoutSessionExpiresAt &&
      ad.checkoutSessionExpiresAt.getTime() > now.getTime()
    ) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          ad.stripeCheckoutSessionId,
        );
        if (existing.status === "open" && existing.url) {
          return {
            mode: "checkout" as const,
            checkoutUrl: existing.url,
            sessionId: existing.id,
          };
        }
      } catch (err) {
        logger.warn(
          { adId: id, sessionId: ad.stripeCheckoutSessionId, err },
          "Failed to reuse ad checkout session; creating a new one",
        );
      }
    }

    const reservationExpiry = new Date(now.getTime() + CHECKOUT_RESERVATION_MS);
    const base = env.stripe.clientUrl.replace(/\/$/, "");
    const successUrl = `${base}/supplier/ads?checkout=success&ad=${id}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/supplier/ads?checkout=cancelled&ad=${id}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: feeCents,
              product_data: {
                name: `Sponsored advertisement — ${ad.durationDays} days`,
                metadata: { adId: id },
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        metadata: { kind: "ad", adId: id, userId },
        payment_intent_data: { metadata: { kind: "ad", adId: id, userId } },
      },
      { idempotencyKey: `ad_checkout_${id}_${reservationExpiry.getTime()}` },
    );

    if (!session.url) {
      throw new BadRequestError("Stripe did not return a Checkout URL");
    }

    await prisma.advertisement.update({
      where: { id },
      data: {
        feeAmount: feeCents,
        stripeCheckoutSessionId: session.id,
        checkoutSessionExpiresAt: reservationExpiry,
      },
    });

    return {
      mode: "checkout" as const,
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  },

  /** After returning from Checkout, confirm payment in case the webhook lagged. */
  async confirmCheckout(userId: string, id: string, sessionId: string) {
    if (!isPaymentConfigured()) {
      throw new BadRequestError("Stripe payment is not configured");
    }
    const ad = await loadOwned(userId, id);

    const stripe = getStripe();
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      throw new BadRequestError("Invalid or unknown checkout session");
    }

    if (session.metadata?.adId && session.metadata.adId !== id) {
      throw new BadRequestError("Checkout session does not belong to this ad");
    }
    if (session.metadata?.userId && session.metadata.userId !== userId) {
      throw new BadRequestError("Checkout session does not belong to this user");
    }

    if (session.payment_status === "paid") {
      return serialize(await markAdPaid(ad));
    }

    return serialize(
      await prisma.advertisement.findUniqueOrThrow({ where: { id }, include }),
    );
  },

  /** Webhook entrypoint: apply a verified ad Checkout session. Idempotent. */
  async applyAdCheckoutSession(session: Stripe.Checkout.Session) {
    const adId = session.metadata?.adId;
    if (!adId || session.payment_status !== "paid") return null;

    const ad = await prisma.advertisement.findUnique({ where: { id: adId } });
    if (!ad) return null;
    if (ad.paymentStatus === AdPaymentStatus.PAID) return null; // already applied

    return markAdPaid(ad);
  },

  /** Admin approval workflow: activate (sets live window), reject, or expire. */
  async review(id: string, status: AdStatus, rejectionReason?: string) {
    const ad = await prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundError("Advertisement not found");

    if (status === AdStatus.ACTIVE && ad.status === AdStatus.PENDING_PAYMENT) {
      throw new BadRequestError(
        "This advertisement has not been paid for and cannot be activated",
      );
    }

    if (status === AdStatus.REJECTED && !rejectionReason) {
      throw new BadRequestError("A rejection reason is required");
    }

    const now = new Date();
    const data: Prisma.AdvertisementUpdateInput = { status };
    if (status === AdStatus.ACTIVE) {
      data.startDate = now;
      data.expiryDate = new Date(
        now.getTime() + ad.durationDays * 24 * 60 * 60 * 1000,
      );
      data.rejectionReason = null;
    }
    if (status === AdStatus.REJECTED) {
      data.rejectionReason = rejectionReason;
    }

    const updated = await prisma.advertisement.update({
      where: { id },
      data,
      include,
    });

    await prisma.notification.create({
      data: {
        userId: ad.supplierId,
        type:
          status === AdStatus.ACTIVE
            ? "AD_APPROVED"
            : status === AdStatus.REJECTED
              ? "AD_REJECTED"
              : "SYSTEM",
        title:
          status === AdStatus.ACTIVE
            ? "Advertisement approved"
            : status === AdStatus.REJECTED
              ? "Advertisement rejected"
              : "Advertisement updated",
        subtitle: status === AdStatus.REJECTED ? rejectionReason : ad.title,
        link: `/supplier/ads/${id}`,
      },
    });

    return serialize(updated);
  },

  /** Increments a lightweight engagement metric on an active ad (de-duplicated). */
  async track(id: string, metric: "views" | "clicks", actorKey: string) {
    if (!trackAllowed(`${id}:${metric}:${actorKey}`)) {
      return;
    }
    await prisma.advertisement.updateMany({
      where: {
        id,
        status: AdStatus.ACTIVE,
        OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
      },
      data: { [metric]: { increment: 1 } },
    });
  },

  /** Periodic sweep hook used by the server bootstrap. */
  expireStaleAds,
};
