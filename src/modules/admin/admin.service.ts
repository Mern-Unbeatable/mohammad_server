import { Prisma, SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";
import { NotFoundError } from "@/shared/errors/AppError";

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

export const adminService = {
  /** Headline KPIs for the admin dashboard. */
  async dashboard() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      activeUsers,
      newSubscribers,
      activeSubscriptions,
      newJobs,
      totalListings,
      revenueAgg,
    ] = await prisma.$transaction([
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          startDate: { gte: startOfMonth },
        },
      }),
      prisma.subscription.count({
        where: { status: SubscriptionStatus.ACTIVE },
      }),
      prisma.job.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.listing.count(),
      prisma.subscription.aggregate({
        _sum: { amount: true },
        where: { status: SubscriptionStatus.ACTIVE },
      }),
    ]);

    const monthlyRevenue = (revenueAgg._sum.amount ?? 0) / 100;

    return {
      stats: [
        { id: "active-users", label: "Active Users", value: activeUsers },
        {
          id: "new-subscribers",
          label: "New Subscribers",
          value: newSubscribers,
        },
        {
          id: "active-subscriptions",
          label: "Active Subscriptions",
          value: activeSubscriptions,
        },
        {
          id: "monthly-revenue",
          label: "Monthly Revenue",
          value: monthlyRevenue,
          currency: "EUR",
        },
        { id: "new-jobs", label: "New Job Listings", value: newJobs },
        {
          id: "marketplace-listings",
          label: "Marketplace Listings",
          value: totalListings,
        },
      ],
    };
  },

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

  async getSettings() {
    const settings = await prisma.appSetting.findMany();
    return settings.reduce<Record<string, Prisma.JsonValue>>((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
  },

  async getSetting(key: string) {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundError("Setting not found");
    return setting.value;
  },

  async upsertSetting(key: string, value: Prisma.InputJsonValue) {
    const setting = await prisma.appSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { key: setting.key, value: setting.value };
  },
};
