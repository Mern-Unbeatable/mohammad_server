import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Buckets a list of timestamps into 12 monthly counts for a given year. */
const bucketByMonth = (dates: Date[], year: number): number[] => {
  const buckets = new Array(12).fill(0);
  for (const date of dates) {
    if (date.getFullYear() === year) buckets[date.getMonth()] += 1;
  }
  return buckets;
};

export const statisticsService = {
  /** 12-month time series for user growth and revenue charts. */
  async statistics(year = new Date().getFullYear()) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    const [users, subscriptions] = await Promise.all([
      prisma.user.findMany({
        where: { createdAt: { gte: yearStart, lt: yearEnd } },
        select: { createdAt: true },
      }),
      prisma.subscription.findMany({
        where: {
          startDate: { gte: yearStart, lt: yearEnd },
          status: SubscriptionStatus.ACTIVE,
        },
        select: { startDate: true, plan: true, amount: true },
      }),
    ]);

    const newUsers = bucketByMonth(
      users.map((u) => u.createdAt),
      year,
    );
    const newSubscribers = bucketByMonth(
      subscriptions.map((s) => s.startDate!).filter(Boolean),
      year,
    );

    const monthlyRevenue = new Array(12).fill(0);
    const yearlyRevenue = new Array(12).fill(0);
    for (const sub of subscriptions) {
      if (!sub.startDate || sub.startDate.getFullYear() !== year) continue;
      const month = sub.startDate.getMonth();
      if (sub.plan === SubscriptionPlan.MONTHLY)
        monthlyRevenue[month] += sub.amount / 100;
      if (sub.plan === SubscriptionPlan.YEARLY)
        yearlyRevenue[month] += sub.amount / 100;
    }

    return {
      year,
      labels: MONTH_LABELS,
      series: {
        newUsers,
        newSubscribers,
        monthlyRevenue,
        yearlyRevenue,
      },
    };
  },
};
