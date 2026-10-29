import Stripe from "stripe";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { env } from "@/config/env";
import { BadRequestError, ConflictError, NotFoundError } from "@/shared/errors/AppError";
import { serializeSubscription } from "@/shared/serializers/user.serializer";
import { logger } from "@/config/logger";
import {
  getStripe,
  getStripePriceId,
  isPaymentConfigured,
  planFromStripePriceId,
} from "./stripeClient";
import {
  DEFAULT_TRIAL_DAYS,
  deriveSubscriptionState,
} from "./subscriptionLifecycle";
import { PLAN_CATALOGUE, MEMBERSHIP_FEATURES } from "./planCatalogue";

type SubscribeResult = {
  subscription: ReturnType<typeof serializeSubscription>;
  payment: {
    required: boolean;
    mode: "checkout";
    checkoutUrl: string;
    sessionId: string;
  };
};

/** How long a single in-flight Checkout reservation is held before it lapses. */
const CHECKOUT_RESERVATION_MS = 30 * 60 * 1000;

async function loadSubscription(userId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });
  if (!subscription) throw new NotFoundError("Subscription not found");
  return subscription;
}

async function loadUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, subscription: true },
  });
  if (!user) throw new NotFoundError("User not found");
  return user;
}

/** Persist derived status / trial counters when they drift from stored values. */
async function syncLocalLifecycle(userId: string) {
  const current = await loadSubscription(userId);
  const derived = deriveSubscriptionState(current);

  const needsUpdate =
    current.status !== derived.status ||
    current.trialDaysLeft !== derived.trialDaysLeft;

  if (!needsUpdate) return current;

  return prisma.subscription.update({
    where: { userId },
    data: {
      status: derived.status,
      trialDaysLeft: derived.trialDaysLeft,
    },
  });
}

async function ensureStripeCustomer(userId: string): Promise<string> {
  const user = await loadUser(userId);
  const existing = user.subscription?.stripeCustomerId;
  const stripe = getStripe();

  // Reuse the stored customer only if it still exists in the configured Stripe
  // account. Ids created under a different key/account (test vs live, or a
  // rotated key) are stale and must be recreated, otherwise Checkout fails
  // with "No such customer".
  if (existing) {
    try {
      const customer = await stripe.customers.retrieve(existing);
      if (!(customer as { deleted?: boolean }).deleted) return existing;
    } catch (err) {
      logger.warn(
        { userId, customerId: existing, err },
        "Stored Stripe customer not found in this account — recreating",
      );
    }
  }

  const name = user.profile
    ? `${user.profile.firstName} ${user.profile.lastName}`.trim()
    : undefined;

  const customer = await stripe.customers.create({
    email: user.email,
    name: name || undefined,
    metadata: { userId },
  });

  await prisma.subscription.update({
    where: { userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

function unixToDate(seconds: number | null | undefined): Date | null {
  if (!seconds) return null;
  return new Date(seconds * 1000);
}

function catalogueForPlan(plan: SubscriptionPlan) {
  return PLAN_CATALOGUE.find((p) => p.plan === plan);
}

/**
 * Apply Stripe Subscription object onto the local Subscription row.
 */
export async function applyStripeSubscription(
  stripeSub: Stripe.Subscription,
  fallbackUserId?: string,
) {
  const customerId =
    typeof stripeSub.customer === "string"
      ? stripeSub.customer
      : stripeSub.customer?.id;

  const priceId = stripeSub.items.data[0]?.price?.id ?? null;
  const planKey =
    planFromStripePriceId(priceId) ||
    (stripeSub.metadata?.plan as "MONTHLY" | "YEARLY" | undefined) ||
    null;

  const item = stripeSub.items.data[0];
  const periodStart = unixToDate(item?.current_period_start);
  const periodEnd = unixToDate(item?.current_period_end);

  let local = await prisma.subscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: stripeSub.id },
        ...(customerId ? [{ stripeCustomerId: customerId }] : []),
        ...(fallbackUserId ? [{ userId: fallbackUserId }] : []),
      ],
    },
  });

  if (!local && stripeSub.metadata?.userId) {
    local = await prisma.subscription.findUnique({
      where: { userId: stripeSub.metadata.userId },
    });
  }

  if (!local) {
    logger.warn(
      { stripeSubscriptionId: stripeSub.id, customerId },
      "No local subscription matched Stripe subscription",
    );
    return null;
  }

  const plan =
    planKey === "YEARLY"
      ? SubscriptionPlan.YEARLY
      : planKey === "MONTHLY"
        ? SubscriptionPlan.MONTHLY
        : local.plan === SubscriptionPlan.FREE
          ? SubscriptionPlan.MONTHLY
          : local.plan;

  const catalogue = catalogueForPlan(plan);

  let status: SubscriptionStatus = local.status;
  if (stripeSub.status === "active" || stripeSub.status === "trialing") {
    status = stripeSub.cancel_at_period_end
      ? SubscriptionStatus.CANCELLED
      : SubscriptionStatus.ACTIVE;
  } else if (stripeSub.status === "past_due") {
    // Overdue renewal — restrict premium access until payment recovers.
    status = SubscriptionStatus.PAST_DUE;
  } else if (
    stripeSub.status === "canceled" ||
    stripeSub.status === "incomplete_expired"
  ) {
    status =
      periodEnd && periodEnd.getTime() > Date.now()
        ? SubscriptionStatus.CANCELLED
        : SubscriptionStatus.EXPIRED;
  } else if (stripeSub.status === "unpaid") {
    // Stripe exhausted retries — treat as ended; access denied.
    status = SubscriptionStatus.EXPIRED;
  } else if (stripeSub.status === "incomplete") {
    // Initial payment not confirmed yet — do not grant access; preserve trial.
    status = local.status;
  }

  // A real Stripe subscription means any in-flight Checkout has concluded.
  const checkoutResolved =
    stripeSub.status !== "incomplete" ? null : local.checkoutSessionExpiresAt;

  return prisma.subscription.update({
    where: { id: local.id },
    data: {
      plan,
      status,
      amount: catalogue?.price ?? local.amount,
      billingCycle: catalogue?.billingCycle ?? local.billingCycle,
      startDate: periodStart ?? local.startDate,
      renewalDate: periodEnd ?? local.renewalDate,
      nextPayment:
        stripeSub.cancel_at_period_end || status !== SubscriptionStatus.ACTIVE
          ? null
          : periodEnd,
      paymentMethod: "Stripe",
      trialDaysLeft:
        status === SubscriptionStatus.ACTIVE ? 0 : local.trialDaysLeft,
      checkoutSessionExpiresAt: checkoutResolved,
      stripeCustomerId: customerId ?? local.stripeCustomerId,
      stripeSubscriptionId: stripeSub.id,
      stripePriceId: priceId ?? local.stripePriceId,
    },
  });
}

export async function applyCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return null;

  const userId = session.metadata?.userId;
  const stripe = getStripe();

  if (session.subscription) {
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    const stripeSub = await stripe.subscriptions.retrieve(subId);
    return applyStripeSubscription(stripeSub, userId);
  }

  if (userId && session.payment_status === "paid") {
    // Session completed but subscription expansion missing — mark checkout id only.
    return prisma.subscription.update({
      where: { userId },
      data: {
        stripeCheckoutSessionId: session.id,
        stripeCustomerId:
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id,
      },
    });
  }

  return null;
}

/** Apply a single verified Stripe event to local state. Must be idempotent. */
async function processStripeEvent(event: Stripe.Event, stripe: Stripe) {
  switch (event.type) {
    case "checkout.session.completed": {
      await applyCheckoutSession(event.data.object as Stripe.Checkout.Session);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await applyStripeSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subRef = invoice.parent?.subscription_details?.subscription ?? null;
      if (subRef) {
        const subId = typeof subRef === "string" ? subRef : subRef.id;
        // Re-fetch current subscription state rather than trusting event order.
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        await applyStripeSubscription(stripeSub);
      }
      break;
    }
    default:
      logger.debug({ type: event.type }, "Unhandled Stripe webhook event");
  }
}

export const subscriptionsService = {
  getPlans() {
    return {
      plans: PLAN_CATALOGUE.map((p) => ({
        id: p.id,
        label: p.label,
        price: p.price / 100,
        period: p.period,
        fullPrice: `€${(p.price / 100).toFixed(2)} / ${p.period}`,
        subscribeLabel: `Subscribe — €${(p.price / 100).toFixed(2)} / ${p.period}`,
      })),
      features: MEMBERSHIP_FEATURES,
      trialDays: DEFAULT_TRIAL_DAYS,
      paymentConfigured: isPaymentConfigured(),
      publishableKey: env.stripe.publishableKey || null,
    };
  },

  async getMine(userId: string) {
    const subscription = await syncLocalLifecycle(userId);
    return serializeSubscription(subscription);
  },

  /**
   * Start Stripe Checkout. Never grants ACTIVE until webhook/confirm succeeds.
   * Concurrency-safe: reserves a single in-flight checkout per user and reuses
   * an already-open session for repeated requests.
   */
  async subscribe(
    userId: string,
    plan: SubscriptionPlan,
  ): Promise<SubscribeResult> {
    if (!isPaymentConfigured()) {
      throw new BadRequestError(
        "Stripe payment is not configured. Set STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, and STRIPE_PRICE_YEARLY.",
      );
    }

    const catalogue = catalogueForPlan(plan);
    if (!catalogue) throw new NotFoundError("Plan not found");

    await syncLocalLifecycle(userId);
    const current = await loadSubscription(userId);
    const derived = deriveSubscriptionState(current);

    if (
      derived.status === SubscriptionStatus.ACTIVE &&
      current.plan === plan &&
      !derived.cancelAtPeriodEnd &&
      current.stripeSubscriptionId
    ) {
      throw new ConflictError("You are already subscribed to this plan", {
        code: "SUBSCRIPTION_ALREADY_ACTIVE",
      });
    }

    const stripe = getStripe();
    const now = new Date();

    // Fast path: reuse an existing still-open Checkout session so repeated
    // clicks never create a second Stripe subscription.
    if (
      current.stripeCheckoutSessionId &&
      current.checkoutSessionExpiresAt &&
      current.checkoutSessionExpiresAt.getTime() > now.getTime()
    ) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          current.stripeCheckoutSessionId,
        );
        if (existing.status === "open" && existing.url) {
          return {
            subscription: serializeSubscription(current),
            payment: {
              required: true,
              mode: "checkout",
              checkoutUrl: existing.url,
              sessionId: existing.id,
            },
          };
        }
      } catch (err) {
        // Stored session id is unknown to this Stripe account (stale/rotated
        // key). Fall through to release the reservation and start fresh.
        logger.warn(
          { userId, sessionId: current.stripeCheckoutSessionId, err },
          "Stored Checkout session not found — starting a new one",
        );
      }
      // Reservation held a closed or stale session — release it before re-locking.
      await prisma.subscription.updateMany({
        where: {
          userId,
          stripeCheckoutSessionId: current.stripeCheckoutSessionId,
        },
        data: { checkoutSessionExpiresAt: null },
      });
    }

    // Atomically reserve the checkout window. Only one concurrent request wins.
    const reservationExpiry = new Date(now.getTime() + CHECKOUT_RESERVATION_MS);
    const reserved = await prisma.subscription.updateMany({
      where: {
        userId,
        OR: [
          { checkoutSessionExpiresAt: null },
          { checkoutSessionExpiresAt: { lte: now } },
        ],
      },
      data: { checkoutSessionExpiresAt: reservationExpiry },
    });
    if (reserved.count === 0) {
      throw new ConflictError("A checkout is already in progress", {
        code: "CHECKOUT_IN_PROGRESS",
      });
    }

    const customerId = await ensureStripeCustomer(userId);
    const priceId = getStripePriceId(
      plan === SubscriptionPlan.YEARLY ? "YEARLY" : "MONTHLY",
    );

    const successUrl = `${env.stripe.clientUrl.replace(/\/$/, "")}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${env.stripe.clientUrl.replace(/\/$/, "")}/subscription?checkout=cancelled`;
    const planKey = plan === SubscriptionPlan.YEARLY ? "YEARLY" : "MONTHLY";

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: userId,
          metadata: { userId, plan: planKey },
          subscription_data: { metadata: { userId, plan: planKey } },
          allow_promotion_codes: true,
        },
        // Scope idempotency to this reservation so transparent retries of the
        // create call never yield a second Checkout session.
        { idempotencyKey: `checkout_${userId}_${reservationExpiry.getTime()}` },
      );
    } catch (err) {
      // Release the reservation so the user can retry.
      await prisma.subscription.updateMany({
        where: { userId, checkoutSessionExpiresAt: reservationExpiry },
        data: { checkoutSessionExpiresAt: null },
      });
      throw err;
    }

    if (!session.url) {
      await prisma.subscription.updateMany({
        where: { userId, checkoutSessionExpiresAt: reservationExpiry },
        data: { checkoutSessionExpiresAt: null },
      });
      throw new BadRequestError("Stripe did not return a Checkout URL");
    }

    await prisma.subscription.update({
      where: { userId },
      data: {
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: customerId,
        stripePriceId: priceId,
        // Intentionally do NOT set ACTIVE here.
      },
    });

    const refreshed = await loadSubscription(userId);

    return {
      subscription: serializeSubscription(refreshed),
      payment: {
        required: true,
        mode: "checkout",
        checkoutUrl: session.url,
        sessionId: session.id,
      },
    };
  },

  /**
   * After returning from Checkout, confirm session and sync if webhook lagged.
   */
  async confirmCheckout(userId: string, sessionId: string) {
    if (!isPaymentConfigured()) {
      throw new BadRequestError("Stripe payment is not configured");
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (session.metadata?.userId && session.metadata.userId !== userId) {
      throw new BadRequestError("Checkout session does not belong to this user");
    }

    if (
      session.client_reference_id &&
      session.client_reference_id !== userId
    ) {
      throw new BadRequestError("Checkout session does not belong to this user");
    }

    await applyCheckoutSession(session);

    if (session.subscription) {
      const subId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;
      const stripeSub = await stripe.subscriptions.retrieve(subId);
      await applyStripeSubscription(stripeSub, userId);
    }

    return serializeSubscription(await syncLocalLifecycle(userId));
  },

  async cancel(userId: string) {
    await syncLocalLifecycle(userId);
    const current = await loadSubscription(userId);
    const derived = deriveSubscriptionState(current);

    if (
      derived.status !== SubscriptionStatus.ACTIVE &&
      derived.status !== SubscriptionStatus.TRIAL &&
      derived.status !== SubscriptionStatus.PAST_DUE &&
      !(
        derived.status === SubscriptionStatus.CANCELLED &&
        derived.cancelAtPeriodEnd
      )
    ) {
      throw new BadRequestError("There is no active subscription to cancel");
    }

    if (
      derived.status === SubscriptionStatus.CANCELLED &&
      derived.cancelAtPeriodEnd
    ) {
      return serializeSubscription(current);
    }

    // Trial without Stripe subscription — end immediately.
    if (
      (current.status === SubscriptionStatus.TRIAL ||
        derived.status === SubscriptionStatus.TRIAL) &&
      !current.stripeSubscriptionId
    ) {
      const now = new Date();
      const subscription = await prisma.subscription.update({
        where: { userId },
        data: {
          status: SubscriptionStatus.CANCELLED,
          trialDaysLeft: 0,
          renewalDate: now,
          nextPayment: null,
        },
      });
      return serializeSubscription(subscription);
    }

    if (current.stripeSubscriptionId && isPaymentConfigured()) {
      const stripe = getStripe();
      const stripeSub = await stripe.subscriptions.update(
        current.stripeSubscriptionId,
        { cancel_at_period_end: true },
      );
      const updated = await applyStripeSubscription(stripeSub, userId);
      return serializeSubscription(updated ?? (await loadSubscription(userId)));
    }

    const subscription = await prisma.subscription.update({
      where: { userId },
      data: {
        status: SubscriptionStatus.CANCELLED,
        nextPayment: null,
      },
    });
    return serializeSubscription(subscription);
  },

  async handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!env.stripe.webhookSecret) {
      throw new BadRequestError("STRIPE_WEBHOOK_SECRET is not configured");
    }
    if (!signature) {
      throw new BadRequestError("Missing Stripe-Signature header");
    }

    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.stripe.webhookSecret,
      );
    } catch (err) {
      logger.warn({ err }, "Stripe webhook signature verification failed");
      throw new BadRequestError("Invalid Stripe webhook signature");
    }

    // Idempotency: never process the same Stripe event id twice.
    const existing = await prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existing?.processingStatus === "PROCESSED") {
      return { received: true, duplicate: true };
    }

    if (!existing) {
      try {
        await prisma.stripeWebhookEvent.create({
          data: {
            stripeEventId: event.id,
            eventType: event.type,
            processingStatus: "PROCESSING",
            attemptCount: 1,
            stripeCreatedAt: event.created
              ? new Date(event.created * 1000)
              : null,
          },
        });
      } catch {
        // Unique-constraint race: another worker is handling this event.
        return { received: true, duplicate: true };
      }
    } else {
      await prisma.stripeWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          processingStatus: "PROCESSING",
          attemptCount: { increment: 1 },
        },
      });
    }

    try {
      await processStripeEvent(event, stripe);
      await prisma.stripeWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          processingStatus: "PROCESSED",
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (err) {
      await prisma.stripeWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          processingStatus: "FAILED",
          lastError: String(err instanceof Error ? err.message : err).slice(
            0,
            500,
          ),
        },
      });
      // Surface the failure so Stripe retries delivery.
      throw err;
    }

    return { received: true };
  },
};

// Re-export catalogue helpers used by serializers/tests if needed
export { PLAN_CATALOGUE, MEMBERSHIP_FEATURES, DEFAULT_TRIAL_DAYS };
