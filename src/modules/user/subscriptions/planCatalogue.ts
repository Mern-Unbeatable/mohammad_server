import { SubscriptionPlan } from "@prisma/client";

/** Static plan catalogue — amounts in cents (display / local mirror of Stripe Prices). */
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
