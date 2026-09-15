import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";
import { serializeSubscription } from "@/shared/serializers/user.serializer";

/** Static plan catalogue mirrored from the frontend subscription page. */
export const PLAN_CATALOGUE = [
  {
    id: "monthly",
    plan: SubscriptionPlan.MONTHLY,
    label: "Monthly",
    price: 1999,
    period: "month",
    billingCycle: "Monthly",
  },
  {
    id: "yearly",
    plan: SubscriptionPlan.YEARLY,
    label: "Yearly",
    price: 23988,
    period: "year",
    billingCycle: "Yearly",
  },
] as const;

export const MEMBERSHIP_FEATURES = [
  "Full professional profile & photo",
  "Unlimited connections",
  "Professional feed — posts, questions, information",
  "Private & group messaging",
  "Audio calls with contacts",
  "Lab Marketplace — buy, sell & exchange equipment",
  "Recruitment — browse & apply for jobs",
  "General — events, training, news & documents",
  "Global search across the entire network",
  "Notification centre",
];

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
    };
  },

  async getMine(userId: string) {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
    });
    if (!subscription) throw new NotFoundError("Subscription not found");
    return serializeSubscription(subscription);
  },

  async subscribe(
    userId: string,
    plan: SubscriptionPlan,
    paymentMethod?: string,
  ) {
    const catalogue = PLAN_CATALOGUE.find((p) => p.plan === plan);
    if (!catalogue) throw new NotFoundError("Plan not found");

    const now = new Date();
    const renewal = new Date(now);
    if (plan === SubscriptionPlan.MONTHLY)
      renewal.setMonth(renewal.getMonth() + 1);
    else renewal.setFullYear(renewal.getFullYear() + 1);

    const subscription = await prisma.subscription.update({
      where: { userId },
      data: {
        plan,
        status: SubscriptionStatus.ACTIVE,
        amount: catalogue.price,
        billingCycle: catalogue.billingCycle,
        startDate: now,
        renewalDate: renewal,
        nextPayment: renewal,
        paymentMethod: paymentMethod ?? "Card",
        trialDaysLeft: 0,
      },
    });
    return serializeSubscription(subscription);
  },

  async cancel(userId: string) {
    const subscription = await prisma.subscription.update({
      where: { userId },
      data: { status: SubscriptionStatus.CANCELLED },
    });
    return serializeSubscription(subscription);
  },
};
