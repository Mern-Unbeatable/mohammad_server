import { SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma";

export const dashboardService = {
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
        where: {
          status: SubscriptionStatus.ACTIVE,
          startDate: { gte: startOfMonth },
        },
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
};
