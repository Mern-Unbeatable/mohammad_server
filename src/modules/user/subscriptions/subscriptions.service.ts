import Stripe from "stripe";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { env } from "@/config/env";
import { BadRequestError, NotFoundError } from "@/shared/errors/AppError";
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
  if (existing) return existing;

  const stripe = getStripe();
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
  if (
    stripeSub.status === "active" ||
    stripeSub.status === "trialing" ||
    stripeSub.status === "past_due"
  ) {
    status = stripeSub.cancel_at_period_end
      ? SubscriptionStatus.CANCELLED
      : SubscriptionStatus.ACTIVE;
  } else if (
    stripeSub.status === "canceled" ||
    stripeSub.status === "unpaid" ||
    stripeSub.status === "incomplete_expired"
  ) {
    status =
      periodEnd && periodEnd.getTime() > Date.now()
        ? SubscriptionStatus.CANCELLED
        : SubscriptionStatus.EXPIRED;
  } else if (stripeSub.status === "incomplete") {
    // Payment not confirmed yet — do not grant ACTIVE.
    status = local.status;
  }

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
      throw new BadRequestError("You are already subscribed to this plan");
    }

    const customerId = await ensureStripeCustomer(userId);
    const priceId = getStripePriceId(
      plan === SubscriptionPlan.YEARLY ? "YEARLY" : "MONTHLY",
    );
    const stripe = getStripe();

    const successUrl = `${env.stripe.clientUrl.replace(/\/$/, "")}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${env.stripe.clientUrl.replace(/\/$/, "")}/subscription?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: {
        userId,
        plan: plan === SubscriptionPlan.YEARLY ? "YEARLY" : "MONTHLY",
      },
      subscription_data: {
        metadata: {
          userId,
          plan: plan === SubscriptionPlan.YEARLY ? "YEARLY" : "MONTHLY",
        },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) {
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

    switch (event.type) {
      case "checkout.session.completed": {
        await applyCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applyStripeSubscription(
          event.data.object as Stripe.Subscription,
        );
        break;
      }
      case "invoice.payment_failed":
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subRef =
          invoice.parent?.subscription_details?.subscription ?? null;
        if (subRef) {
          const subId = typeof subRef === "string" ? subRef : subRef.id;
          const stripeSub = await stripe.subscriptions.retrieve(subId);
          await applyStripeSubscription(stripeSub);
        }
        break;
      }
      default:
        logger.debug({ type: event.type }, "Unhandled Stripe webhook event");
    }

    return { received: true };
  },
};

// Re-export catalogue helpers used by serializers/tests if needed
export { PLAN_CATALOGUE, MEMBERSHIP_FEATURES, DEFAULT_TRIAL_DAYS };
